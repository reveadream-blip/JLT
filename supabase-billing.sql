-- Billing setup: Stripe + PromptPay plans and subscription unlocking
-- Run with postgres role in Supabase SQL Editor

begin;

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  amount_thb integer not null,
  interval text not null check (interval in ('month', 'year')),
  provider text not null check (provider in ('stripe', 'promptpay')),
  auto_renew boolean not null default false,
  free_months integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  plan_code text not null,
  provider text not null check (provider in ('stripe', 'promptpay')),
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  auto_renew boolean not null default false,
  external_customer_id text,
  external_subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  plan_code text not null,
  provider text not null check (provider in ('stripe', 'promptpay')),
  amount_thb integer not null,
  status text not null check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  external_payment_id text,
  checkout_url text,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_subscriptions_owner_id on public.billing_subscriptions(owner_id);
create index if not exists idx_billing_subscriptions_status_end on public.billing_subscriptions(status, current_period_end);
create index if not exists idx_billing_payments_owner_id on public.billing_payments(owner_id);

alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;

drop policy if exists "billing_subscriptions_owner_all" on public.billing_subscriptions;
create policy "billing_subscriptions_owner_all" on public.billing_subscriptions
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "billing_payments_owner_all" on public.billing_payments;
create policy "billing_payments_owner_all" on public.billing_payments
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

insert into public.billing_plans (code, name, amount_thb, interval, provider, auto_renew, free_months, active)
values
  ('stripe_monthly_auto_990', 'Abonnement mensuel Stripe', 990, 'month', 'stripe', true, 0, true),
  ('promptpay_monthly_990', 'Forfait mensuel PromptPay', 990, 'month', 'promptpay', false, 0, true),
  ('promptpay_yearly_9900', 'Forfait annuel PromptPay (2 mois offerts)', 9900, 'year', 'promptpay', false, 2, true)
on conflict (code) do update
set
  name = excluded.name,
  amount_thb = excluded.amount_thb,
  interval = excluded.interval,
  provider = excluded.provider,
  auto_renew = excluded.auto_renew,
  free_months = excluded.free_months,
  active = excluded.active;

commit;
