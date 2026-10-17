-- Run this complete migration once before deploying the PIN-enabled app.
-- Run in Supabase SQL Editor. This script is safe to run again.
create table if not exists public.santa_sessions (
  id text primary key,
  host_hash text not null,
  people jsonb not null,
  matches jsonb,
  expires_at timestamptz not null default (now() + interval '7 days')
);
-- Upgrade old six-hour sessions once; never extend an already migrated session.
alter table public.santa_sessions add column if not exists pin_version integer not null default 0;
update public.santa_sessions set expires_at = expires_at + interval '6 days 18 hours', pin_version = 1
  where pin_version = 0 and expires_at > now();
update public.santa_sessions set pin_version = 1 where pin_version = 0;
alter table public.santa_sessions alter column pin_version set default 1;
alter table public.santa_sessions alter column expires_at set default (now() + interval '7 days');
create index if not exists santa_sessions_expiry on public.santa_sessions(expires_at);
alter table public.santa_sessions enable row level security;
-- No browser access: only the server's secret key may use this table/function.
revoke all on public.santa_sessions from anon, authenticated;
grant all on public.santa_sessions to service_role;

create or replace function public.santa_action(
  action text, session_id text, secret_hash text, payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  s public.santa_sessions%rowtype;
  person jsonb;
  new_person jsonb;
  public_people jsonb;
  recipient text;
  ids jsonb;
  n integer;
  person_index integer;
  old_hash text;
  failures integer;
begin
  if action in ('create', 'join') and (
    jsonb_typeof(payload->'name') is distinct from 'string'
    or length(trim(payload->>'name')) not between 1 and 40
    or coalesce(length(payload->>'participant_id'), 0) < 20
    or coalesce(payload->>'pin_hash', '') !~ '^[a-f0-9]{64}$'
  ) then return jsonb_build_object('status',400,'error','Skriv ett namn med 1–40 tecken.'); end if;

  if action = 'create' then
    -- Serialize capacity checks across concurrent function instances.
    perform pg_advisory_xact_lock(731004);
    delete from public.santa_sessions where expires_at <= now();
    if (select count(*) from public.santa_sessions) >= 1000 then
      return jsonb_build_object('status',503,'error','Det är fullt just nu. Försök senare.');
    end if;
    new_person := jsonb_build_object('id',payload->>'participant_id','name',trim(payload->>'name'),'secret',secret_hash,'pin_hash',payload->>'pin_hash');
    insert into public.santa_sessions(id, host_hash, people)
      values(session_id, secret_hash, jsonb_build_array(new_person));
  end if;

  -- Lock this session for the entire operation: join/draw/end cannot interleave.
  select * into s from public.santa_sessions where id = session_id for update;
  if not found then
    return jsonb_build_object('status',404,'error','Sessionen har avslutats eller finns inte.');
  end if;
  if s.expires_at <= now() then
    delete from public.santa_sessions where id = session_id;
    return jsonb_build_object('status',404,'error','Sessionen har avslutats eller finns inte.');
  end if;

  if action = 'lobby' then
    select jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name') order by ord)
      into public_people from jsonb_array_elements(s.people) with ordinality as people(p,ord);
    return jsonb_build_object('id',s.id,'people',public_people,'drawn',s.matches is not null,
      'expires',floor(extract(epoch from s.expires_at)*1000));
  end if;

  if action = 'resume' then
    select p, (ord-1)::integer into person, person_index
      from jsonb_array_elements(s.people) with ordinality as people(p,ord)
      where p->>'id' = payload->>'participant_id';
    if person is null then
      return jsonb_build_object('status',401,'error','Fel namn eller PIN-kod.');
    end if;
    if coalesce((person->>'locked_until')::timestamptz, '-infinity'::timestamptz) > now() then
      return jsonb_build_object('status',429,'error','För många felaktiga försök. Försök igen om 15 minuter.');
    end if;
    if coalesce(payload->>'pin_hash','') !~ '^[a-f0-9]{64}$'
      or person->>'pin_hash' is distinct from payload->>'pin_hash' then
      failures := case when (person->>'locked_until') is not null then 1
        else coalesce((person->>'failures')::integer,0)+1 end;
      person := person || jsonb_build_object('failures',failures,'locked_until',
        case when failures >= 5 then now()+interval '15 minutes' else null end);
      s.people := jsonb_set(s.people,array[person_index::text],person);
      update public.santa_sessions set people=s.people where id=session_id;
      return jsonb_build_object('status',case when failures >= 5 then 429 else 401 end,
        'error',case when failures >= 5 then 'För många felaktiga försök. Försök igen om 15 minuter.' else 'Fel namn eller PIN-kod.' end);
    end if;
    old_hash := person->>'secret';
    person := (person - 'failures' - 'locked_until') || jsonb_build_object('secret',secret_hash);
    s.people := jsonb_set(s.people,array[person_index::text],person);
    if s.host_hash = old_hash then s.host_hash := secret_hash; end if;
    update public.santa_sessions set people=s.people,host_hash=s.host_hash where id=session_id;
  end if;

  if action = 'join' then
    if s.matches is not null then
      return jsonb_build_object('status',409,'error','Lottningen är redan klar. Det går inte att gå med nu.');
    end if;
    if jsonb_array_length(s.people) >= 100 then
      return jsonb_build_object('status',409,'error','Sessionen är full (100 deltagare).');
    end if;
    if exists(select 1 from jsonb_array_elements(s.people) p where lower(p->>'name') = lower(trim(payload->>'name'))) then
      return jsonb_build_object('status',409,'error','Namnet används redan. Lägg till exempel till ditt efternamn.');
    end if;
    new_person := jsonb_build_object('id',payload->>'participant_id','name',trim(payload->>'name'),'secret',secret_hash,'pin_hash',payload->>'pin_hash');
    s.people := s.people || jsonb_build_array(new_person);
    update public.santa_sessions set people = s.people where id = session_id;
  end if;

  select p into person from jsonb_array_elements(s.people) p where p->>'secret' = secret_hash;
  if person is null then
    return jsonb_build_object('status',401,'error','Du behöver gå med i sessionen.');
  end if;
  if action = 'set_pin' then
    if person->>'pin_hash' is not null then
      return jsonb_build_object('status',409,'error','Du har redan valt en PIN-kod.');
    end if;
    if coalesce(payload->>'pin_hash','') !~ '^[a-f0-9]{64}$' then
      return jsonb_build_object('status',400,'error','Ogiltig PIN-kod.');
    end if;
    select jsonb_agg(case when p->>'id'=person->>'id' then p || jsonb_build_object('pin_hash',payload->>'pin_hash') else p end order by ord)
      into s.people from jsonb_array_elements(s.people) with ordinality as people(p,ord);
    update public.santa_sessions set people=s.people where id=session_id;
    person := person || jsonb_build_object('pin_hash',payload->>'pin_hash');
  end if;
  if action in ('draw','end') and s.host_hash <> secret_hash then
    return jsonb_build_object('status',403,'error','Bara värden kan lotta eller avsluta sessionen.');
  end if;
  if action = 'end' then
    delete from public.santa_sessions where id = session_id;
    return '{}'::jsonb;
  end if;
  if action = 'draw' then
    if s.matches is not null then
      return jsonb_build_object('status',409,'error','Lottningen är redan klar.');
    end if;
    select jsonb_agg(p->>'id' order by ord) into ids
      from jsonb_array_elements(s.people) with ordinality as people(p,ord);
    if ids is distinct from payload->'ids' then
      return jsonb_build_object('status',409,'error','En deltagare gick precis med. Kontrollera listan och lotta igen.');
    end if;
    n := jsonb_array_length(s.people);
    if n < 2 then return jsonb_build_object('status',400,'error','Minst två deltagare behövs.'); end if;
    if jsonb_typeof(payload->'matches') is distinct from 'object' then
      return jsonb_build_object('status',400,'error','Ogiltig lottning.');
    end if;
    if (select count(*) from jsonb_each_text(payload->'matches')) <> n
      or (select count(distinct value) from jsonb_each_text(payload->'matches')) <> n
      or exists(select 1 from jsonb_each_text(payload->'matches') m
        where m.key = m.value or not (ids ? m.key) or not (ids ? m.value)) then
      return jsonb_build_object('status',400,'error','Ogiltig lottning.');
    end if;
    s.matches := payload->'matches';
    update public.santa_sessions set matches = s.matches where id = session_id;
  end if;
  if action not in ('create','join','read','draw','resume','set_pin') then
    return jsonb_build_object('status',400,'error','Ogiltig åtgärd.');
  end if;
  select jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name') order by ord)
    into public_people from jsonb_array_elements(s.people) with ordinality as people(p,ord);
  select p->>'name' into recipient from jsonb_array_elements(s.people) p
    where p->>'id' = s.matches->>(person->>'id');
  return jsonb_build_object('id',s.id,'people',public_people,'me',person->>'id',
    'isHost',s.host_hash = secret_hash,'drawn',s.matches is not null,
    'recipient',recipient,'requiresPin',person->>'pin_hash' is null,'expires',floor(extract(epoch from s.expires_at)*1000));
end;
$$;
revoke all on function public.santa_action(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.santa_action(text,text,text,jsonb) to service_role;

-- Enable scheduled deletion. Expired sessions are inaccessible even between runs.
create extension if not exists pg_cron;
do $$
begin
  if not exists(select 1 from cron.job where jobname = 'secret-santa-cleanup') then
    perform cron.schedule('secret-santa-cleanup', '*/10 * * * *',
      'delete from public.santa_sessions where expires_at <= now()');
  end if;
end;
$$;
