-- JLT - Email/Auth diagnostics (SQL only)
-- Run with postgres role in Supabase SQL Editor
-- This script helps you SEE what is broken in DB/auth data.
-- Note: SMTP provider, templates, and rate limits are not configurable via SQL.

begin;

-- 1) Recent auth users and confirmation status
select
  id,
  email,
  created_at,
  email_confirmed_at,
  confirmed_at,
  last_sign_in_at,
  is_sso_user,
  banned_until
from auth.users
order by created_at desc
limit 50;

-- 2) Users still waiting for email confirmation
select
  id,
  email,
  created_at
from auth.users
where email_confirmed_at is null
order by created_at desc
limit 50;

-- 3) Compare auth.users vs public.profiles (missing profile rows)
select
  u.id as auth_user_id,
  u.email,
  u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
order by u.created_at desc
limit 100;

-- 4) Ensure trigger function exists
select
  p.proname as function_name,
  n.nspname as schema_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'handle_new_user';

-- 5) Ensure trigger exists on auth.users
select
  t.tgname as trigger_name,
  c.relname as table_name,
  n.nspname as schema_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth'
  and c.relname = 'users'
  and t.tgname = 'on_auth_user_created'
  and not t.tgisinternal;

-- 6) Backfill missing profiles (safe to run multiple times)
insert into public.profiles (id, full_name)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

commit;

-- Optional DEV ONLY (do not use in production):
-- To manually confirm one email account:
-- update auth.users
-- set email_confirmed_at = now(), confirmed_at = now()
-- where email = 'test@example.com';
