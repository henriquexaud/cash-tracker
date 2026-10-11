begin;

-- Divisões: shared groups, kept apart from the private financial_sync document.
-- Run after schema.sql. Can be executed again.
create table if not exists public.split_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_at timestamptz not null default now()
);
-- A member keeps its name and history if the account is later deleted.
create table if not exists public.split_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.split_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 40),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);
-- Expense: paid_by paid amount (cents), shared equally by participants.
-- Settlement: paid_by handed amount to the single participant.
create table if not exists public.split_entries (
  id uuid primary key,
  group_id uuid not null references public.split_groups(id) on delete cascade,
  kind text not null check (kind in ('expense', 'settlement')),
  description text not null default '' check (char_length(description) <= 80),
  amount bigint not null check (amount > 0 and amount <= 9007199254740991),
  paid_by uuid not null references public.split_members(id),
  participants uuid[] not null check (cardinality(participants) between 1 and 50),
  entry_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists split_members_user on public.split_members(user_id);
create index if not exists split_entries_group on public.split_entries(group_id);

alter table public.split_groups enable row level security;
alter table public.split_groups force row level security;
alter table public.split_members enable row level security;
alter table public.split_members force row level security;
alter table public.split_entries enable row level security;
alter table public.split_entries force row level security;
revoke all on public.split_groups, public.split_members, public.split_entries from public, anon, authenticated;
-- Participants read their groups; every write goes through the functions below.
grant select on public.split_groups, public.split_members, public.split_entries to authenticated;

-- Membership is resolved outside the policies so they do not recurse into split_members.
create or replace function public.is_split_member(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.split_members where group_id = target and user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_split_member(uuid) from public, anon, authenticated;
grant execute on function public.is_split_member(uuid) to authenticated;

drop policy if exists "Read own split groups" on public.split_groups;
create policy "Read own split groups" on public.split_groups
  for select to authenticated using (public.is_split_member(id));
drop policy if exists "Read members of own split groups" on public.split_members;
create policy "Read members of own split groups" on public.split_members
  for select to authenticated using (public.is_split_member(group_id));
drop policy if exists "Read entries of own split groups" on public.split_entries;
create policy "Read entries of own split groups" on public.split_entries
  for select to authenticated using (public.is_split_member(group_id));

create or replace function public.split_create_group(group_name text, member_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  created uuid;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  group_name := btrim(coalesce(group_name, ''));
  member_name := btrim(coalesce(member_name, ''));
  if char_length(group_name) not between 1 and 60 or char_length(member_name) not between 1 and 40 then
    raise exception 'Invalid name' using errcode = '22023';
  end if;
  if (select count(*) from public.split_members where user_id = owner_id) >= 100 then
    raise exception 'Too many groups' using errcode = '54000';
  end if;
  -- The first 12 hex digits of a v4 UUID are all random (48 bits).
  insert into public.split_groups(name, invite_code)
    values (group_name, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))
    returning id into created;
  insert into public.split_members(group_id, user_id, name) values (created, owner_id, member_name);
  return created;
end;
$$;

create or replace function public.split_join_group(code text, member_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  target uuid;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  member_name := btrim(coalesce(member_name, ''));
  if char_length(member_name) not between 1 and 40 then
    raise exception 'Invalid name' using errcode = '22023';
  end if;
  -- Joins to the same group serialize on its row.
  select id into target from public.split_groups
    where invite_code = upper(regexp_replace(coalesce(code, ''), '[^0-9A-Za-z]', '', 'g')) for update;
  if target is null then raise exception 'Invite not found' using errcode = 'P0002'; end if;
  if exists(select 1 from public.split_members where group_id = target and user_id = owner_id) then
    return target;
  end if;
  if (select count(*) from public.split_members where group_id = target) >= 50
    or (select count(*) from public.split_members where user_id = owner_id) >= 100 then
    raise exception 'Group limit reached' using errcode = '54000';
  end if;
  insert into public.split_members(group_id, user_id, name) values (target, owner_id, member_name);
  return target;
end;
$$;

create or replace function public.split_save_entry(
  entry_id uuid, target_group uuid, entry_kind text, entry_description text,
  entry_amount bigint, payer uuid, entry_participants uuid[], entry_day date
) returns void language plpgsql security definer set search_path = '' as $$
declare
  people integer := cardinality(entry_participants);
begin
  if auth.uid() is null or target_group is null or not public.is_split_member(target_group) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  entry_description := btrim(coalesce(entry_description, ''));
  if entry_id is null or entry_day is null or payer is null
    or entry_kind is null or entry_kind not in ('expense', 'settlement')
    or entry_amount is null or entry_amount <= 0 or entry_amount > 9007199254740991
    or char_length(entry_description) > 80
    or people is null or people not between 1 and 50
    or (select count(distinct person) from unnest(entry_participants) person) <> people
    -- Payer and every participant must belong to this same group.
    or (select count(*) from public.split_members where group_id = target_group and id = any(entry_participants)) <> people
    or not exists(select 1 from public.split_members where group_id = target_group and id = payer)
    or (entry_kind = 'expense' and (entry_description = '' or (people = 1 and entry_participants[1] = payer)))
    or (entry_kind = 'settlement' and (people <> 1 or entry_participants[1] = payer)) then
    raise exception 'Invalid entry' using errcode = '22023';
  end if;
  perform 1 from public.split_groups where id = target_group for update;
  -- An existing ID can only be edited inside its own group and keeps its kind.
  if exists(select 1 from public.split_entries where id = entry_id and (group_id <> target_group or kind <> entry_kind)) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  if (select count(*) from public.split_entries where group_id = target_group) >= 10000 then
    raise exception 'Too many entries' using errcode = '54000';
  end if;
  insert into public.split_entries(id, group_id, kind, description, amount, paid_by, participants, entry_date)
    values (entry_id, target_group, entry_kind, entry_description, entry_amount, payer, entry_participants, entry_day)
    on conflict (id) do update set
      description = excluded.description, amount = excluded.amount, paid_by = excluded.paid_by,
      participants = excluded.participants, entry_date = excluded.entry_date, updated_at = clock_timestamp();
end;
$$;

create or replace function public.split_delete_entry(entry_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Entries of other groups are indistinguishable from missing ones.
  delete from public.split_entries where id = entry_id and public.is_split_member(group_id);
end;
$$;

revoke all on function public.split_create_group(text, text) from public, anon, authenticated;
revoke all on function public.split_join_group(text, text) from public, anon, authenticated;
revoke all on function public.split_save_entry(uuid, uuid, text, text, bigint, uuid, uuid[], date) from public, anon, authenticated;
revoke all on function public.split_delete_entry(uuid) from public, anon, authenticated;
grant execute on function public.split_create_group(text, text) to authenticated;
grant execute on function public.split_join_group(text, text) to authenticated;
grant execute on function public.split_save_entry(uuid, uuid, text, text, bigint, uuid, uuid[], date) to authenticated;
grant execute on function public.split_delete_entry(uuid) to authenticated;

commit;
