begin;

-- One private synchronization document per auth account. Passwords stay in Supabase Auth.
create table if not exists public.financial_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null default '{"version":1,"records":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint financial_sync_document check (
    coalesce(document ->> 'version' = '1' and jsonb_typeof(document -> 'records') = 'object', false)
  )
);
alter table public.financial_sync enable row level security;
alter table public.financial_sync force row level security;
revoke all on public.financial_sync from public, anon, authenticated;
-- All mutations go through the atomic merge, so clients cannot replace someone else's document.
grant select on public.financial_sync to authenticated;
drop policy if exists "Read own sync document" on public.financial_sync;
create policy "Read own sync document" on public.financial_sync
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.sync_financial_data(incoming jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  existing jsonb;
  merged jsonb;
  record_key text;
  candidate jsonb;
  previous jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if incoming is null or jsonb_typeof(incoming) <> 'object'
    or incoming ->> 'version' is distinct from '1'
    or jsonb_typeof(incoming -> 'records') is distinct from 'object'
    or octet_length(incoming::text) > 20000000 then
    raise exception 'Invalid synchronization document' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(incoming -> 'records')) > 100000 then
    raise exception 'Too many records' using errcode = '22023';
  end if;
  -- Concurrent first writes and subsequent edits serialize on this account's row.
  insert into public.financial_sync(user_id) values(owner_id) on conflict(user_id) do nothing;
  select document into existing from public.financial_sync where user_id = owner_id for update;
  merged := existing -> 'records';
  for record_key, candidate in select key, value from jsonb_each(incoming -> 'records') loop
    if length(record_key) > 1024 or jsonb_typeof(candidate) <> 'object'
      or not (candidate ? 'value') or jsonb_typeof(candidate -> 'stamp') is distinct from 'string'
      or (candidate ->> 'stamp') !~ '^[0-9]{16}:[0-9]{6}:[0-9a-f-]{36}$' then
      raise exception 'Invalid synchronization record' using errcode = '22023';
    end if;
    previous := merged -> record_key;
    if previous is null or (candidate ->> 'stamp') collate "C" > (previous ->> 'stamp') collate "C" then
      merged := jsonb_set(merged, array[record_key], candidate, true);
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(merged)) > 100000 or octet_length(merged::text) > 20000000 then
    raise exception 'Synchronization document limit exceeded' using errcode = '22023';
  end if;
  existing := jsonb_build_object('version', 1, 'records', merged);
  update public.financial_sync set document = existing, updated_at = clock_timestamp() where user_id = owner_id;
  return jsonb_build_object('document', existing, 'server_time', clock_timestamp());
end;
$$;
revoke all on function public.sync_financial_data(jsonb) from public, anon, authenticated;
grant execute on function public.sync_financial_data(jsonb) to authenticated;

commit;
