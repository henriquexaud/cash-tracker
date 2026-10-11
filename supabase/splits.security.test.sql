-- Run after schema.sql and splits.sql, in SQL Editor or a disposable PostgreSQL database.
-- All fixtures are rolled back; this creates no lasting accounts, groups or entries.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002'), ('00000000-0000-4000-8000-000000000003');
set local role anon;
do $$ begin
  begin perform public.split_create_group('Casa', 'Ana'); raise exception 'FAIL: anonymous RPC allowed';
  exception when insufficient_privilege then null; end;
  begin perform name from public.split_groups; raise exception 'FAIL: anonymous read allowed';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin perform public.split_create_group('Casa', 'Ana'); raise exception 'FAIL: unauthenticated RPC allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- Account 1 creates a group.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ declare g uuid; me uuid; begin
  g := public.split_create_group('  Casa  ', 'Ana');
  select id into me from public.split_members where group_id = g and user_id = auth.uid();
  perform set_config('test.group', g::text, true), set_config('test.ana', me::text, true),
    set_config('test.code', (select invite_code from public.split_groups where id = g), true);
  if (select name from public.split_groups where id = g) <> 'Casa' or current_setting('test.code') !~ '^[0-9A-F]{12}$' then raise exception 'FAIL: group creation'; end if;
  begin insert into public.split_groups(name, invite_code) values ('X', 'X'); raise exception 'FAIL: direct group insert permitted'; exception when insufficient_privilege then null; end;
  begin insert into public.split_members(group_id, user_id, name) values (g, auth.uid(), 'X'); raise exception 'FAIL: direct member insert permitted'; exception when insufficient_privilege then null; end;
  begin update public.split_groups set name = 'X'; raise exception 'FAIL: direct update permitted'; exception when insufficient_privilege then null; end;
  begin delete from public.split_entries; raise exception 'FAIL: direct delete permitted'; exception when insufficient_privilege then null; end;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000001', g, 'expense', 'Mercado', 1000, me, array[me], '2026-10-01'); raise exception 'FAIL: payer-only expense accepted'; exception when invalid_parameter_value then null; end;
end $$;

-- Account 2 sees nothing before joining, and joins only with the right code.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ declare g uuid := current_setting('test.group'); ana uuid := current_setting('test.ana'); me uuid; begin
  if exists(select 1 from public.split_groups) or exists(select 1 from public.split_members) or exists(select 1 from public.split_entries) then raise exception 'FAIL: group visible before joining'; end if;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000001', g, 'expense', 'Mercado', 1000, ana, array[ana], '2026-10-01'); raise exception 'FAIL: non-member wrote an entry'; exception when insufficient_privilege then null; end;
  begin perform public.split_join_group('000000000000', 'Bia'); raise exception 'FAIL: wrong code accepted'; exception when no_data_found then null; end;
  if public.split_join_group(lower(substr(current_setting('test.code'), 1, 6)) || '-' || substr(current_setting('test.code'), 7), 'Bia') <> g then raise exception 'FAIL: join'; end if;
  if public.split_join_group(current_setting('test.code'), 'Outra') <> g or (select count(*) from public.split_members where group_id = g) <> 2 then raise exception 'FAIL: repeated join created a second member'; end if;
  select id into me from public.split_members where group_id = g and user_id = auth.uid();
  perform set_config('test.bia', me::text, true);
  perform public.split_save_entry('00000000-0000-4000-9000-000000000001', g, 'expense', ' Mercado ', 1000, ana, array[ana, me], '2026-10-01');
  if (select description || ':' || amount from public.split_entries where group_id = g) <> 'Mercado:1000' then raise exception 'FAIL: entry not saved'; end if;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000002', g, 'expense', 'X', 1000, ana, array[me, '00000000-0000-4000-9000-00000000ffff'::uuid], '2026-10-01'); raise exception 'FAIL: outsider participant accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000002', g, 'expense', 'X', 1000, ana, array[me, me], '2026-10-01'); raise exception 'FAIL: duplicate participant accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000002', g, 'expense', 'X', 0, ana, array[me], '2026-10-01'); raise exception 'FAIL: zero amount accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000002', g, 'expense', '', 100, ana, array[me], '2026-10-01'); raise exception 'FAIL: empty description accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000002', g, 'settlement', '', 100, me, array[me], '2026-10-01'); raise exception 'FAIL: settlement to self accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000001', g, 'settlement', '', 100, me, array[ana], '2026-10-01'); raise exception 'FAIL: entry changed kind'; exception when insufficient_privilege then null; end;
  perform public.split_save_entry('00000000-0000-4000-9000-000000000003', g, 'settlement', '', 500, me, array[ana], '2026-10-02');
end $$;

-- Account 3 is not a participant: no reads, no edits, no deletions, even through its own group.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
do $$ declare g uuid := current_setting('test.group'); own uuid; me uuid; begin
  if exists(select 1 from public.split_groups) or exists(select 1 from public.split_members) or exists(select 1 from public.split_entries) then raise exception 'FAIL: other group visible'; end if;
  if public.is_split_member(g) then raise exception 'FAIL: membership'; end if;
  perform public.split_delete_entry('00000000-0000-4000-9000-000000000001');
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000009', g, 'expense', 'X', 100, current_setting('test.ana')::uuid, array[current_setting('test.bia')::uuid], '2026-10-01'); raise exception 'FAIL: outsider wrote an entry'; exception when insufficient_privilege then null; end;
  own := public.split_create_group('Outro', 'Caio');
  select id into me from public.split_members where group_id = own;
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000009', own, 'expense', 'X', 100, me, array[current_setting('test.bia')::uuid], '2026-10-01'); raise exception 'FAIL: member of another group accepted'; exception when invalid_parameter_value then null; end;
  perform public.split_join_group('000000000000', 'Caio');
  raise exception 'FAIL: wrong code accepted';
exception when no_data_found then null;
end $$;
do $$ declare own uuid; begin
  -- The block above rolled back; an existing entry ID cannot be moved into another group.
  own := public.split_create_group('Outro', 'Caio');
  begin perform public.split_save_entry('00000000-0000-4000-9000-000000000001', own, 'expense', 'X', 1, (select id from public.split_members where group_id = own), array[(select id from public.split_members where group_id = own)], '2026-10-01'); raise exception 'FAIL: invalid entry accepted'; exception when invalid_parameter_value then null; end;
  if (select count(*) from public.split_groups) <> 1 then raise exception 'FAIL: group scope'; end if;
end $$;

-- Participants still see the untouched entry, then edit and delete it.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ declare g uuid := current_setting('test.group'); ana uuid := current_setting('test.ana'); bia uuid := current_setting('test.bia'); begin
  if (select count(*) from public.split_groups) <> 1 or (select count(*) from public.split_members) <> 2 then raise exception 'FAIL: participant scope'; end if;
  if (select amount from public.split_entries where id = '00000000-0000-4000-9000-000000000001') <> 1000 then raise exception 'FAIL: outsider deleted or changed an entry'; end if;
  perform public.split_save_entry('00000000-0000-4000-9000-000000000001', g, 'expense', 'Mercado', 1500, bia, array[ana], '2026-10-03');
  if (select amount || ':' || paid_by || ':' || entry_date from public.split_entries where id = '00000000-0000-4000-9000-000000000001') <> '1500:' || bia || ':2026-10-03' then raise exception 'FAIL: edit'; end if;
  perform public.split_delete_entry('00000000-0000-4000-9000-000000000001');
  if (select count(*) from public.split_entries) <> 1 then raise exception 'FAIL: delete'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.split_groups) <> 2 or (select count(*) from public.financial_sync) <> 0 then raise exception 'FAIL: groups mixed or financial data touched'; end if;
end $$;
rollback;
