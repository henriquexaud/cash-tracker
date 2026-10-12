-- Run once in Supabase SQL Editor, after schema.sql and splits.sql. Setup: docs/notifications.md.
-- Push subscriptions per device, the monthly reminder and the notices of shared groups.
-- Nothing here reads or writes financial_sync.
create extension if not exists pg_net;
create extension if not exists pg_cron;

begin;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  -- Preferences of this device: day of the monthly reminder and notices of shared groups.
  reminder_day smallint check (reminder_day between 1 and 31),
  splits boolean not null default false,
  timezone text not null,
  -- Month (YYYY-MM) already reminded, or reported by the app as having salary and budget.
  reminded_month text,
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions(user_id);

-- No policies: the app only writes through the functions below and never reads this table.
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

create or replace function public.push_subscribe(
  sub_endpoint text, sub_p256dh text, sub_auth text,
  sub_reminder_day integer, sub_splits boolean, sub_timezone text, done_month text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if sub_endpoint is null or char_length(sub_endpoint) > 2048
    -- Only the push services of the browsers: the server never posts to an arbitrary address.
    or sub_endpoint !~ '^https://([a-z0-9-]+\.)*(googleapis\.com|push\.apple\.com|mozilla\.com|windows\.com)/'
    or sub_p256dh is null or sub_p256dh !~ '^[A-Za-z0-9_-]{80,100}$'
    or sub_auth is null or sub_auth !~ '^[A-Za-z0-9_-]{16,32}$'
    or (sub_reminder_day is not null and sub_reminder_day not between 1 and 31)
    or sub_splits is null
    or sub_timezone is null or char_length(sub_timezone) > 64
    or (done_month is not null and done_month !~ '^\d{4}-(0[1-9]|1[0-2])$') then
    raise exception 'Invalid subscription' using errcode = '22023';
  end if;
  begin
    perform now() at time zone sub_timezone;
  exception when others then
    raise exception 'Invalid subscription' using errcode = '22023';
  end;
  if (select count(*) from public.push_subscriptions where user_id = owner_id and endpoint <> sub_endpoint) >= 20 then
    raise exception 'Too many devices' using errcode = '54000';
  end if;
  -- A browser that changes account takes its subscription along; a new device
  -- inherits what the account was already reminded of.
  insert into public.push_subscriptions as current
      (endpoint, user_id, p256dh, auth, reminder_day, splits, timezone, reminded_month)
    values (sub_endpoint, owner_id, sub_p256dh, sub_auth, sub_reminder_day, sub_splits, sub_timezone,
      (select max(reminded_month) from public.push_subscriptions where user_id = owner_id))
    on conflict (endpoint) do update set
      user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      reminder_day = excluded.reminder_day, splits = excluded.splits, timezone = excluded.timezone,
      reminded_month = case when current.user_id = excluded.user_id
        then current.reminded_month else excluded.reminded_month end,
      updated_at = now();
  if done_month is not null then
    update public.push_subscriptions set reminded_month = done_month
      where user_id = owner_id and (reminded_month is null or reminded_month < done_month);
  end if;
end;
$$;

create or replace function public.push_unsubscribe(sub_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = sub_endpoint and user_id = auth.uid();
end;
$$;

-- Hands a notification job to the Edge Function. Without the two Vault secrets nothing is sent.
create or replace function public.push_send(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target text;
  secret text;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_secret';
  if target is null or secret is null then return; end if;
  perform net.http_post(
    url := target,
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 30000
  );
end;
$$;

-- Devices whose reminder is due: from the chosen day (or the last day of a shorter
-- month), after 9h in the device's time zone, once per month. Claimed before sending.
create or replace function public.push_claim_reminders()
returns table(endpoint text, p256dh text, auth text, month text)
language sql security definer set search_path = '' as $$
  update public.push_subscriptions as current set reminded_month = due.month
    from (
      select row.endpoint, to_char(clock.local, 'YYYY-MM') as month
        from public.push_subscriptions row
        cross join lateral (select now() at time zone row.timezone as local) clock
        where row.reminder_day is not null
          and extract(hour from clock.local) >= 9
          and extract(day from clock.local) >= least(
            row.reminder_day,
            extract(day from date_trunc('month', clock.local) + interval '1 month - 1 day'))
          and row.reminded_month is distinct from to_char(clock.local, 'YYYY-MM')
    ) due
    where current.endpoint = due.endpoint
    returning current.endpoint, current.p256dh, current.auth, due.month;
$$;

-- Group, participants and the devices of every participant except whoever made the change.
create or replace function public.push_split_targets(target_group uuid, actor uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'group', (select jsonb_build_object('id', id, 'name', name) from public.split_groups where id = target_group),
    'actor', (select id from public.split_members where group_id = target_group and user_id = actor),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name))
      from public.split_members where group_id = target_group), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(jsonb_build_object(
        'endpoint', device.endpoint, 'p256dh', device.p256dh, 'auth', device.auth, 'member', member.id))
      from public.split_members member
      join public.push_subscriptions device on device.user_id = member.user_id
      where member.group_id = target_group and device.splits
        and member.user_id is distinct from actor), '[]'::jsonb)
  );
$$;

-- Subscriptions the push service reported as expired.
create or replace function public.push_forget(endpoints text[])
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = any(endpoints);
$$;

-- A notification is a convenience: no failure here may undo the entry being saved.
create or replace function public.split_entries_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.push_send(jsonb_build_object(
      'type', 'split', 'op', 'delete', 'actor', auth.uid(), 'entry', to_jsonb(old)));
  elsif tg_op = 'INSERT' then
    perform public.push_send(jsonb_build_object(
      'type', 'split', 'op', 'insert', 'actor', auth.uid(), 'entry', to_jsonb(new)));
  elsif (new.description, new.amount, new.paid_by, new.participants, new.entry_date)
      is distinct from (old.description, old.amount, old.paid_by, old.participants, old.entry_date) then
    perform public.push_send(jsonb_build_object(
      'type', 'split', 'op', 'update', 'actor', auth.uid(), 'entry', to_jsonb(new)));
  end if;
  return null;
exception when others then
  return null;
end;
$$;
drop trigger if exists split_entries_push on public.split_entries;
create trigger split_entries_push after insert or update or delete on public.split_entries
  for each row execute function public.split_entries_push();

revoke all on function public.push_subscribe(text, text, text, integer, boolean, text, text) from public, anon, authenticated;
revoke all on function public.push_unsubscribe(text) from public, anon, authenticated;
revoke all on function public.push_send(jsonb) from public, anon, authenticated;
revoke all on function public.push_claim_reminders() from public, anon, authenticated;
revoke all on function public.push_split_targets(uuid, uuid) from public, anon, authenticated;
revoke all on function public.push_forget(text[]) from public, anon, authenticated;
revoke all on function public.split_entries_push() from public, anon, authenticated;
grant execute on function public.push_subscribe(text, text, text, integer, boolean, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
-- Only the Edge Function, with the service role, lists devices.
grant execute on function public.push_claim_reminders() to service_role;
grant execute on function public.push_split_targets(uuid, uuid) to service_role;
grant execute on function public.push_forget(text[]) to service_role;

commit;

-- Hourly check of the monthly reminder. Scheduling again under the same name replaces the job.
select cron.schedule('cash-tracker-reminders', '5 * * * *',
  $$select public.push_send('{"type":"reminder"}'::jsonb)$$);
