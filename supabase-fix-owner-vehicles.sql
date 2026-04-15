-- Fix owner_id for existing rows created from dashboard
-- Replace the email below with your current account email

begin;

-- 1) Set your email here
with me as (
  select id
  from auth.users
  where email = 'dooghystyle@gmail.com'
  limit 1
)
update public.vehicles v
set owner_id = me.id
from me
where v.owner_id is null;

with me as (
  select id
  from auth.users
  where email = 'dooghystyle@gmail.com'
  limit 1
)
update public.clients c
set owner_id = me.id
from me
where c.owner_id is null;

with me as (
  select id
  from auth.users
  where email = 'dooghystyle@gmail.com'
  limit 1
)
update public.contracts c
set owner_id = me.id
from me
where c.owner_id is null;

with me as (
  select id
  from auth.users
  where email = 'dooghystyle@gmail.com'
  limit 1
)
update public.pricing_plans p
set owner_id = me.id
from me
where p.owner_id is null;

commit;
