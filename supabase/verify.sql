-- Run after setup.sql/migrate-pin.sql. Test records are rolled back.
begin;
do $$
declare a jsonb; b jsonb; r jsonb; ids jsonb; matches jsonb; i integer; expiry timestamptz;
begin
  a := public.santa_action('create','setup-verification-room','host-hash',
    jsonb_build_object('name','Alice','participant_id','verification-alice-id','pin_hash',repeat('a',64)));
  if a ? 'status' or (a->>'isHost')::boolean is distinct from true then raise exception 'Create failed: %',a; end if;
  b := public.santa_action('join','setup-verification-room','guest-hash',
    jsonb_build_object('name','Bob','participant_id','verification-bob-id-01','pin_hash',repeat('b',64)));
  if b ? 'status' or jsonb_array_length(b->'people') is distinct from 2 then raise exception 'Join failed: %',b; end if;
  if (a->>'expires')::bigint < extract(epoch from now()+interval '6 days')*1000 then raise exception 'Expiry too short'; end if;
  r := public.santa_action('lobby','setup-verification-room','');
  if r ? 'recipient' or r ? 'me' or (r->'people'->0) ? 'pin_hash' or (r->'people'->0) ? 'secret' then raise exception 'Lobby leaked private data'; end if;
  r := public.santa_action('read','setup-verification-room','wrong-hash');
  if (r->>'status')::int is distinct from 401 then raise exception 'Authorization failed: %',r; end if;
  r := public.santa_action('resume','setup-verification-room','new-host-hash',jsonb_build_object('participant_id','verification-alice-id','pin_hash',repeat('c',64)));
  if (r->>'status')::int is distinct from 401 then raise exception 'Wrong PIN accepted'; end if;
  r := public.santa_action('resume','setup-verification-room','new-host-hash',jsonb_build_object('participant_id','verification-alice-id','pin_hash',repeat('a',64)));
  if r ? 'status' or (r->>'isHost')::boolean is distinct from true then raise exception 'Host recovery failed: %',r; end if;
  r := public.santa_action('read','setup-verification-room','host-hash');
  if (r->>'status')::int is distinct from 401 then raise exception 'Old token remains valid'; end if;
  ids := '["verification-alice-id","verification-bob-id-01"]';
  matches := '{"verification-alice-id":"verification-bob-id-01","verification-bob-id-01":"verification-alice-id"}';
  r := public.santa_action('draw','setup-verification-room','guest-hash',jsonb_build_object('ids',ids,'matches',matches));
  if (r->>'status')::int is distinct from 403 then raise exception 'Host restriction failed: %',r; end if;
  r := public.santa_action('draw','setup-verification-room','new-host-hash',jsonb_build_object('ids',ids,'matches',matches));
  if (r->>'recipient') is distinct from 'Bob' or r ? 'matches' then raise exception 'Private view failed: %',r; end if;
  r := public.santa_action('resume','setup-verification-room','new-guest-hash',jsonb_build_object('participant_id','verification-bob-id-01','pin_hash',repeat('b',64)));
  if (r->>'recipient') is distinct from 'Alice' or (r->>'isHost')::boolean is distinct from false then raise exception 'Post-draw recovery failed: %',r; end if;
  for i in 1..5 loop
    r := public.santa_action('resume','setup-verification-room','attacker',jsonb_build_object('participant_id','verification-bob-id-01','pin_hash',repeat('c',64)));
  end loop;
  if (r->>'status')::int is distinct from 429 then raise exception 'PIN attempt limit failed'; end if;
  r := public.santa_action('resume','setup-verification-room','guest-again',jsonb_build_object('participant_id','verification-bob-id-01','pin_hash',repeat('b',64)));
  if (r->>'status')::int is distinct from 429 then raise exception 'Lock bypassed'; end if;
  if has_function_privilege('anon','public.santa_action(text,text,text,jsonb)','execute') then raise exception 'Anonymous RPC access'; end if;
  if has_table_privilege('authenticated','public.santa_sessions','select') then raise exception 'Browser table access'; end if;
  perform public.santa_action('end','setup-verification-room','new-host-hash');
  if exists(select 1 from public.santa_sessions where id='setup-verification-room') then raise exception 'Delete failed'; end if;
end;
$$;
rollback;
