-- JLT - Auth/Profile emergency fix
-- Run with postgres role in Supabase SQL Editor

begin;

create extension if not exists pgcrypto;

-- Ensure profiles table exists
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text default 'owner',
  created_at timestamptz not null default now()
);

-- Ensure RLS enabled
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (id = auth.uid());

-- Trigger function: create profile row on new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill missing profiles for already existing users
insert into public.profiles (id, full_name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

commit;

-- Quick checks (run after script):
-- select count(*) as auth_users from auth.users;
-- select count(*) as profiles_rows from public.profiles;
-- select u.id from auth.users u left join public.profiles p on p.id = u.id where p.id is null;
