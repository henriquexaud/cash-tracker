-- Run after schema.sql, splits.sql and notifications.sql, in SQL Editor or a disposable PostgreSQL database.
-- All fixtures are rolled back, including any queued request: no notification is sent.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002'), ('00000000-0000-4000-8000-000000000003');
select set_config('test.endpoint', 'https://fcm.googleapis.com/fcm/send/', true),
  set_config('test.key', repeat('A', 87), true), set_config('test.auth', repeat('B', 22), true),
  -- A time zone where it is already past 9h, so a due reminder can be claimed at any time.
  set_config('test.zone', case when extract(hour from now() at time zone 'UTC') >= 9 then 'UTC' else 'Pacific/Kiritimati' end, true);

set local role anon;
do $$ begin
  begin perform public.push_subscribe(current_setting('test.endpoint') || 'a', current_setting('test.key'), current_setting('test.auth'), 1, true, 'UTC', null);
    raise exception 'FAIL: anonymous subscription allowed'; exception when insufficient_privilege then null; end;
  begin perform endpoint from public.push_subscriptions; raise exception 'FAIL: anonymous read allowed';
  exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
do $$ begin
  begin perform public.push_subscribe(current_setting('test.endpoint') || 'a', current_setting('test.key'), current_setting('test.auth'), 1, true, 'UTC', null);
    raise exception 'FAIL: subscription without account allowed'; exception when insufficient_privilege then null; end;
end $$;

-- Account 1 subscribes one device; only the functions touch the table.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ declare e text := current_setting('test.endpoint'); k text := current_setting('test.key'); a text := current_setting('test.auth'); z text := current_setting('test.zone'); begin
  perform public.push_subscribe(e || 'ana', k, a, 1, true, z, null);
  begin perform endpoint from public.push_subscriptions; raise exception 'FAIL: direct read permitted'; exception when insufficient_privilege then null; end;
  begin insert into public.push_subscriptions(endpoint, user_id, p256dh, auth, timezone) values (e || 'x', auth.uid(), k, a, 'UTC'); raise exception 'FAIL: direct insert permitted'; exception when insufficient_privilege then null; end;
  begin delete from public.push_subscriptions; raise exception 'FAIL: direct delete permitted'; exception when insufficient_privilege then null; end;
  begin perform public.push_claim_reminders(); raise exception 'FAIL: account listed devices'; exception when insufficient_privilege then null; end;
  begin perform public.push_split_targets(gen_random_uuid(), auth.uid()); raise exception 'FAIL: account listed targets'; exception when insufficient_privilege then null; end;
  begin perform public.push_forget(array[e || 'ana']); raise exception 'FAIL: account removed devices'; exception when insufficient_privilege then null; end;
  begin perform public.push_send('{}'::jsonb); raise exception 'FAIL: account triggered a send'; exception when insufficient_privilege then null; end;
  begin perform public.push_subscribe('https://example.com/push', k, a, 1, true, z, null); raise exception 'FAIL: arbitrary address accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.push_subscribe('https://fcm.googleapis.com.example.com/x', k, a, 1, true, z, null); raise exception 'FAIL: lookalike address accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.push_subscribe('http://fcm.googleapis.com/x', k, a, 1, true, z, null); raise exception 'FAIL: insecure address accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.push_subscribe(e || 'x', 'short', a, 1, true, z, null); raise exception 'FAIL: invalid key accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.push_subscribe(e || 'x', k, a, 32, true, z, null); raise exception 'FAIL: invalid day accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.push_subscribe(e || 'x', k, a, 1, true, 'Not/AZone', null); raise exception 'FAIL: invalid time zone accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.push_subscribe(e || 'x', k, a, 1, true, z, '2026-13'); raise exception 'FAIL: invalid month accepted'; exception when sqlstate '22023' then null; end;
  -- Other browsers' services are accepted.
  perform public.push_subscribe('https://web.push.apple.com/abc', k, a, null, true, z, null);
  perform public.push_subscribe('https://updates.push.services.mozilla.com/wpush/v2/abc', k, a, null, false, z, null);
  perform public.push_unsubscribe('https://updates.push.services.mozilla.com/wpush/v2/abc');
end $$;

-- Account 2 cannot remove the device of account 1; its own device has no reminder.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ begin
  perform public.push_unsubscribe(current_setting('test.endpoint') || 'ana');
  perform public.push_subscribe(current_setting('test.endpoint') || 'bia', current_setting('test.key'), current_setting('test.auth'), null, true, current_setting('test.zone'), null);
end $$;

-- The server claims each due reminder once per month.
reset role;
set local role service_role;
do $$ declare claimed text[]; begin
  select array_agg(endpoint order by endpoint) into claimed from public.push_claim_reminders();
  if claimed is distinct from array[current_setting('test.endpoint') || 'ana'] then raise exception 'FAIL: due reminders %', claimed; end if;
  if (select count(*) from public.push_claim_reminders()) <> 0 then raise exception 'FAIL: reminder repeated in the month'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.push_subscriptions) <> 3 then raise exception 'FAIL: subscriptions kept'; end if;
  if (select reminded_month from public.push_subscriptions where endpoint = current_setting('test.endpoint') || 'ana')
    <> to_char(now() at time zone current_setting('test.zone'), 'YYYY-MM') then raise exception 'FAIL: reminded month'; end if;
  update public.push_subscriptions set reminded_month = null;
end $$;

-- A month the app reports as complete is not reminded, on any device of the account;
-- a device added later inherits it, and a browser that changes account does not.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ declare e text := current_setting('test.endpoint'); k text := current_setting('test.key'); a text := current_setting('test.auth'); z text := current_setting('test.zone'); begin
  perform public.push_subscribe('https://web.push.apple.com/abc', k, a, 1, true, z, to_char(now() at time zone z, 'YYYY-MM'));
  perform public.push_subscribe(e || 'ana-2', k, a, 1, false, z, null);
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select public.push_subscribe(current_setting('test.endpoint') || 'ana-2', current_setting('test.key'), current_setting('test.auth'), 1, true, current_setting('test.zone'), null);
reset role;
set local role service_role;
do $$ declare claimed text[]; begin
  select array_agg(endpoint order by endpoint) into claimed from public.push_claim_reminders();
  if claimed is distinct from array[current_setting('test.endpoint') || 'ana-2'] then raise exception 'FAIL: complete month reminded %', claimed; end if;
end $$;
reset role;
do $$ begin
  if (select user_id from public.push_subscriptions where endpoint = current_setting('test.endpoint') || 'ana-2')
    <> '00000000-0000-4000-8000-000000000003' then raise exception 'FAIL: browser kept the previous account'; end if;
end $$;

-- Shared group: accounts 1 and 2 participate, account 3 does not.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ declare g uuid; begin
  g := public.split_create_group('Casa', 'Ana');
  perform set_config('test.group', g::text, true),
    set_config('test.ana', (select id::text from public.split_members where group_id = g and user_id = auth.uid()), true),
    set_config('test.code', (select invite_code from public.split_groups where id = g), true);
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ declare g uuid := current_setting('test.group')::uuid; bia uuid; entry uuid := gen_random_uuid(); begin
  perform public.split_join_group(current_setting('test.code'), 'Bia');
  select id into bia from public.split_members where group_id = g and user_id = auth.uid();
  perform set_config('test.bia', bia::text, true);
  -- Saving, editing and deleting keep working with the notification trigger in place.
  perform public.split_save_entry(entry, g, 'expense', 'Mercado', 10000, bia, array[bia, current_setting('test.ana')::uuid], current_date);
  perform public.split_save_entry(entry, g, 'expense', 'Mercado', 12000, bia, array[bia, current_setting('test.ana')::uuid], current_date);
  if (select amount from public.split_entries where id = entry) <> 12000 then raise exception 'FAIL: entry not saved'; end if;
  perform public.split_delete_entry(entry);
  if exists(select 1 from public.split_entries where id = entry) then raise exception 'FAIL: entry not deleted'; end if;
end $$;

-- Targets: the devices with the option enabled of every participant except the author.
reset role;
set local role service_role;
do $$ declare result jsonb; begin
  result := public.push_split_targets(current_setting('test.group')::uuid, '00000000-0000-4000-8000-000000000002');
  if result->'group'->>'name' <> 'Casa' or result->>'actor' <> current_setting('test.bia') or jsonb_array_length(result->'members') <> 2 then
    raise exception 'FAIL: group details %', result; end if;
  -- Ana's first device has the option on and her Apple device too; ana-2 now belongs to account 3.
  if (select array_agg(target->>'endpoint' order by target->>'endpoint') from jsonb_array_elements(result->'targets') target)
      is distinct from array[current_setting('test.endpoint') || 'ana', 'https://web.push.apple.com/abc']
    or exists(select 1 from jsonb_array_elements(result->'targets') target where target->>'member' <> current_setting('test.ana')) then
    raise exception 'FAIL: targets %', result->'targets'; end if;
  result := public.push_split_targets(current_setting('test.group')::uuid, '00000000-0000-4000-8000-000000000001');
  if (select array_agg(target->>'endpoint') from jsonb_array_elements(result->'targets') target)
      is distinct from array[current_setting('test.endpoint') || 'bia'] then raise exception 'FAIL: author notified %', result->'targets'; end if;
  perform public.push_forget(array[current_setting('test.endpoint') || 'bia']);
  if jsonb_array_length(public.push_split_targets(current_setting('test.group')::uuid, '00000000-0000-4000-8000-000000000001')->'targets') <> 0 then
    raise exception 'FAIL: expired device kept'; end if;
end $$;
reset role;
-- Deleting an account removes its devices.
delete from auth.users where id = '00000000-0000-4000-8000-000000000003';
do $$ begin
  if exists(select 1 from public.push_subscriptions where user_id = '00000000-0000-4000-8000-000000000003') then raise exception 'FAIL: devices of a deleted account kept'; end if;
end $$;
select 'notifications security test passed' as result;
rollback;
