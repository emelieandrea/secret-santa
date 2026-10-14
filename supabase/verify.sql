-- Optional: run AFTER setup.sql in SQL Editor. Everything rolls back.
begin;
do $$
declare a jsonb; b jsonb; r jsonb; ids jsonb; matches jsonb;
begin
  a := public.santa_action('create','setup-verification-room','host-hash',
    '{"name":"Alice","participant_id":"verification-alice-id"}');
  b := public.santa_action('join','setup-verification-room','guest-hash',
    '{"name":"Bob","participant_id":"verification-bob-id-01"}');
  if a ? 'status' or (a->>'isHost')::boolean is distinct from true then
    raise exception 'Create failed: %', a;
  end if;
  if b ? 'status' or jsonb_array_length(b->'people') is distinct from 2
    or (b->>'isHost')::boolean is distinct from false then
    raise exception 'Join failed: %', b;
  end if;
  r := public.santa_action('read','setup-verification-room','wrong-hash');
  if (r->>'status')::int is distinct from 401 then raise exception 'Authorization failed: %', r; end if;
  ids := '["verification-alice-id","verification-bob-id-01"]';
  matches := '{"verification-alice-id":"verification-bob-id-01","verification-bob-id-01":"verification-alice-id"}';
  r := public.santa_action('draw','setup-verification-room','guest-hash',jsonb_build_object('ids',ids,'matches',matches));
  if (r->>'status')::int is distinct from 403 then raise exception 'Host restriction failed: %', r; end if;
  r := public.santa_action('draw','setup-verification-room','host-hash',jsonb_build_object('ids',ids,'matches',matches));
  if (r->>'recipient') is distinct from 'Bob' or r ? 'matches' or (r->'people'->0) ? 'secret' then raise exception 'Private view failed'; end if;
  r := public.santa_action('read','setup-verification-room','guest-hash');
  if (r->>'recipient') is distinct from 'Alice' then raise exception 'Guest recipient failed'; end if;
  r := public.santa_action('draw','setup-verification-room','host-hash',jsonb_build_object('ids',ids,'matches',matches));
  if (r->>'status')::int is distinct from 409 then raise exception 'Redraw restriction failed: %', r; end if;
  if has_function_privilege('anon','public.santa_action(text,text,text,jsonb)','execute') then raise exception 'Anonymous RPC access allowed'; end if;
  if has_table_privilege('authenticated','public.santa_sessions','select') then raise exception 'Browser table access allowed'; end if;
  perform public.santa_action('end','setup-verification-room','host-hash');
  if exists(select 1 from public.santa_sessions where id='setup-verification-room') then raise exception 'Delete failed'; end if;
end;
$$;
rollback;
