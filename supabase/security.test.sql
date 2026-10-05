-- Run after schema.sql, in SQL Editor or a disposable PostgreSQL database.
-- All fixtures are rolled back; this creates no lasting accounts or financial data.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
set local role anon;
do $$ begin
  begin perform public.sync_financial_data('{"version":1,"records":{}}'); raise exception 'FAIL: anonymous RPC allowed';
  exception when insufficient_privilege then null; end;
  begin perform document from public.financial_sync; raise exception 'FAIL: anonymous read allowed';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin perform public.sync_financial_data('{"version":1,"records":{}}'); raise exception 'FAIL: unauthenticated RPC allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ declare result jsonb; begin
  result := public.sync_financial_data('{"version":1,"records":{"[\"salary\",\"2026-10\"]":{"stamp":"0000000000000100:000000:00000000-0000-4000-8000-000000000001","value":{"amount":100}}}}');
  if result #>> array['document','records','["salary","2026-10"]','value','amount'] <> '100' then raise exception 'FAIL: first merge'; end if;
  result := public.sync_financial_data('{"version":1,"records":{"[\"salary\",\"2026-10\"]":{"stamp":"0000000000000200:000000:00000000-0000-4000-8000-000000000001","value":{"amount":200}},"[\"salary\",\"2026-11\"]":{"stamp":"0000000000000200:000000:00000000-0000-4000-8000-000000000001","value":{"amount":300}}}}');
  result := public.sync_financial_data('{"version":1,"records":{"[\"salary\",\"2026-10\"]":{"stamp":"0000000000000100:000000:00000000-0000-4000-8000-000000000001","value":{"amount":100}}}}');
  if result #>> array['document','records','["salary","2026-10"]','value','amount'] <> '200' or result #>> array['document','records','["salary","2026-11"]','value','amount'] <> '300' then raise exception 'FAIL: stale overwrite or independent edit lost'; end if;
  result := public.sync_financial_data('{"version":1,"records":{"[\"salary\",\"2026-10\"]":{"stamp":"0000000000000300:000000:00000000-0000-4000-8000-000000000001","value":null}}}');
  result := public.sync_financial_data('{"version":1,"records":{"[\"salary\",\"2026-10\"]":{"stamp":"0000000000000200:000000:00000000-0000-4000-8000-000000000001","value":{"amount":200}}}}');
  if result #> array['document','records','["salary","2026-10"]','value'] <> 'null'::jsonb then raise exception 'FAIL: deleted record resurrected'; end if;
  begin insert into public.financial_sync(user_id) values(auth.uid()); raise exception 'FAIL: direct replacement permitted'; exception when insufficient_privilege then null; end;
  begin update public.financial_sync set document='{}'; raise exception 'FAIL: direct update permitted'; exception when insufficient_privilege then null; end;
  begin perform public.sync_financial_data('{"version":1,"records":{"bad":{"stamp":"bad","value":1}}}'); raise exception 'FAIL: invalid stamp accepted'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ declare result jsonb; begin
  if exists(select 1 from public.financial_sync) then raise exception 'FAIL: other owner visible'; end if;
  result := public.sync_financial_data('{"version":1,"records":{}}');
  if result -> 'document' -> 'records' <> '{}'::jsonb then raise exception 'FAIL: other owner document returned'; end if;
  if (select count(*) from public.financial_sync) <> 1 then raise exception 'FAIL: account scope'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.financial_sync) <> 2 then raise exception 'FAIL: accounts mixed'; end if;
end $$;
rollback;
