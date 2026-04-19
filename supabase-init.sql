-- JLT Supabase initialization script
-- Run this in Supabase SQL Editor (project: xaplhaibffgxwjaavspz)

create extension if not exists "pgcrypto";

-- Profiles linked to auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company_name text,
  phone text,
  locale text default 'fr',
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  nationality text,
  phone text,
  email text,
  passport_number text,
  passport_photo_path text,
  deposit_amount numeric(10,2) default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('scooter', 'car', 'bike')),
  brand text not null,
  model text not null,
  license_plate text,
  year int,
  daily_price numeric(10,2) not null default 0,
  status text not null default 'available' check (status in ('available', 'reserved', 'maintenance')),
  airtag_code text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  total_price numeric(10,2) not null default 0,
  deposit_amount numeric(10,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'cancelled')),
  signed_at timestamptz,
  signed_contract_url text,
  created_at timestamptz not null default now(),
  constraint contract_dates_valid check (end_at > start_at)
);

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  stage text not null check (stage in ('checkout', 'checkin')),
  notes text,
  damage_flag boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  file_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vehicle_label text not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pricing_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  vehicle_type text not null check (vehicle_type in ('scooter', 'car', 'bike')),
  day_rate numeric(10,2) not null default 0,
  week_rate numeric(10,2) not null default 0,
  month_rate numeric(10,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Backfill for projects where tables already existed without owner_id
alter table public.clients add column if not exists owner_id uuid;
alter table public.vehicles add column if not exists owner_id uuid;
alter table public.contracts add column if not exists owner_id uuid;
alter table public.contracts add column if not exists start_at timestamptz;
alter table public.contracts add column if not exists end_at timestamptz;
alter table public.inspections add column if not exists owner_id uuid;
alter table public.inspection_photos add column if not exists owner_id uuid;
alter table public.vehicle_photos add column if not exists owner_id uuid;
alter table public.vehicle_photos add column if not exists vehicle_id uuid;
alter table public.vehicle_photos add column if not exists vehicle_label text;
alter table public.pricing_plans add column if not exists owner_id uuid;

create index if not exists idx_clients_owner_id on public.clients(owner_id);
create index if not exists idx_vehicles_owner_id on public.vehicles(owner_id);
create index if not exists idx_contracts_owner_id on public.contracts(owner_id);
create index if not exists idx_contracts_vehicle_dates on public.contracts(vehicle_id, start_at, end_at);
create index if not exists idx_inspections_owner_id on public.inspections(owner_id);
create index if not exists idx_vehicle_photos_owner_id on public.vehicle_photos(owner_id);
create index if not exists idx_pricing_plans_owner_id on public.pricing_plans(owner_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, locale)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'fr')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.vehicles enable row level security;
alter table public.contracts enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_photos enable row level security;
alter table public.vehicle_photos enable row level security;
alter table public.pricing_plans enable row level security;

-- Generic owner policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id);

drop policy if exists "clients_owner_all" on public.clients;
create policy "clients_owner_all" on public.clients
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "vehicles_owner_all" on public.vehicles;
create policy "vehicles_owner_all" on public.vehicles
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "contracts_owner_all" on public.contracts;
create policy "contracts_owner_all" on public.contracts
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "inspections_owner_all" on public.inspections;
create policy "inspections_owner_all" on public.inspections
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "inspection_photos_owner_all" on public.inspection_photos;
create policy "inspection_photos_owner_all" on public.inspection_photos
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "vehicle_photos_owner_all" on public.vehicle_photos;
create policy "vehicle_photos_owner_all" on public.vehicle_photos
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "pricing_plans_owner_all" on public.pricing_plans;
create policy "pricing_plans_owner_all" on public.pricing_plans
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Storage bucket for inspection images
insert into storage.buckets (id, name, public)
values ('inspection-photos', 'inspection-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', false)
on conflict (id) do nothing;

drop policy if exists "inspection_photos_bucket_select" on storage.objects;
create policy "inspection_photos_bucket_select" on storage.objects
for select using (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "inspection_photos_bucket_insert" on storage.objects;
create policy "inspection_photos_bucket_insert" on storage.objects
for insert with check (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "inspection_photos_bucket_update" on storage.objects;
create policy "inspection_photos_bucket_update" on storage.objects
for update using (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "inspection_photos_bucket_delete" on storage.objects;
create policy "inspection_photos_bucket_delete" on storage.objects
for delete using (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- vehicle-photos : voir supabase-vehicle-photos-demo-access.sql (préfixe demo/ = lecture publique)
drop policy if exists "vehicle_photos_bucket_select" on storage.objects;
create policy "vehicle_photos_bucket_select" on storage.objects
for select using (
  bucket_id = 'vehicle-photos'
  and (
    (auth.uid() is not null and auth.uid()::text = (storage.foldername(name))[1])
    or (storage.foldername(name))[1] = 'demo'
  )
);

drop policy if exists "vehicle_photos_bucket_insert" on storage.objects;
create policy "vehicle_photos_bucket_insert" on storage.objects
for insert with check (
  bucket_id = 'vehicle-photos'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or (
      (storage.foldername(name))[1] = 'demo'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

drop policy if exists "vehicle_photos_bucket_update" on storage.objects;
create policy "vehicle_photos_bucket_update" on storage.objects
for update using (
  bucket_id = 'vehicle-photos'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or (
      (storage.foldername(name))[1] = 'demo'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

drop policy if exists "vehicle_photos_bucket_delete" on storage.objects;
create policy "vehicle_photos_bucket_delete" on storage.objects
for delete using (
  bucket_id = 'vehicle-photos'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or (
      (storage.foldername(name))[1] = 'demo'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

-- Optional starter pricing rows for current user (run after signup)
-- insert into public.pricing_plans (owner_id, label, vehicle_type, day_rate, week_rate, month_rate)
-- values
--   (auth.uid(), 'Tarif standard Motos', 'scooter', 15, 85, 820),
--   (auth.uid(), 'Haute saison Motos', 'scooter', 22, 130, 1420),
--   (auth.uid(), 'Tarif Voitures', 'car', 45, 270, 990);
