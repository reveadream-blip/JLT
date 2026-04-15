-- JLT - Full database update script (idempotent)
-- Run in Supabase SQL Editor

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Core tables
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text default 'owner',
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  full_name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  brand text not null,
  model text not null,
  type text not null check (type in ('scooter', 'car', 'bike')),
  status text not null default 'available' check (status in ('available', 'reserved', 'maintenance')),
  daily_price numeric(10,2) not null default 0,
  license_plate text,
  year int,
  airtag_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  start_at timestamptz,
  end_at timestamptz,
  total_price numeric(10,2) default 0,
  status text not null default 'active' check (status in ('active', 'done', 'draft', 'cancelled')),
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.pricing_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  label text not null,
  vehicle_type text not null check (vehicle_type in ('scooter', 'car', 'bike')),
  day_rate numeric(10,2) default 0,
  week_rate numeric(10,2) default 0,
  month_rate numeric(10,2) default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  contract_id uuid references public.contracts(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  inspection_id uuid references public.inspections(id) on delete cascade,
  file_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  vehicle_label text not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Compatibility columns (safe reruns)
-- =========================================================

alter table public.clients add column if not exists owner_id uuid;
alter table public.vehicles add column if not exists owner_id uuid;
alter table public.contracts add column if not exists owner_id uuid;
alter table public.pricing_plans add column if not exists owner_id uuid;
alter table public.inspections add column if not exists owner_id uuid;
alter table public.inspection_photos add column if not exists owner_id uuid;
alter table public.contracts add column if not exists start_at timestamptz;
alter table public.contracts add column if not exists end_at timestamptz;
alter table public.vehicles add column if not exists airtag_code text;

-- =========================================================
-- Indexes
-- =========================================================

create index if not exists idx_clients_owner_id on public.clients(owner_id);
create index if not exists idx_vehicles_owner_id on public.vehicles(owner_id);
create index if not exists idx_contracts_owner_id on public.contracts(owner_id);
create index if not exists idx_contracts_client_id on public.contracts(client_id);
create index if not exists idx_contracts_vehicle_id on public.contracts(vehicle_id);
create index if not exists idx_pricing_owner_id on public.pricing_plans(owner_id);
create index if not exists idx_inspections_owner_id on public.inspections(owner_id);
create index if not exists idx_inspection_photos_owner_id on public.inspection_photos(owner_id);
create index if not exists idx_vehicle_photos_owner_id on public.vehicle_photos(owner_id);

-- =========================================================
-- Auto profile on new auth user
-- =========================================================

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

-- =========================================================
-- RLS policies
-- =========================================================

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.vehicles enable row level security;
alter table public.contracts enable row level security;
alter table public.pricing_plans enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_photos enable row level security;
alter table public.vehicle_photos enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (id = auth.uid());

drop policy if exists "clients_owner_all" on public.clients;
create policy "clients_owner_all" on public.clients
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "vehicles_owner_all" on public.vehicles;
create policy "vehicles_owner_all" on public.vehicles
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "contracts_owner_all" on public.contracts;
create policy "contracts_owner_all" on public.contracts
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "pricing_owner_all" on public.pricing_plans;
create policy "pricing_owner_all" on public.pricing_plans
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "inspections_owner_all" on public.inspections;
create policy "inspections_owner_all" on public.inspections
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "inspection_photos_owner_all" on public.inspection_photos;
create policy "inspection_photos_owner_all" on public.inspection_photos
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "vehicle_photos_owner_all" on public.vehicle_photos;
create policy "vehicle_photos_owner_all" on public.vehicle_photos
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- =========================================================
-- Storage buckets + policies
-- =========================================================

insert into storage.buckets (id, name, public)
values ('inspection-photos', 'inspection-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', false)
on conflict (id) do nothing;

drop policy if exists "inspection_photos_select" on storage.objects;
create policy "inspection_photos_select" on storage.objects
for select using (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "inspection_photos_insert" on storage.objects;
create policy "inspection_photos_insert" on storage.objects
for insert with check (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "inspection_photos_update" on storage.objects;
create policy "inspection_photos_update" on storage.objects
for update using (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "inspection_photos_delete" on storage.objects;
create policy "inspection_photos_delete" on storage.objects
for delete using (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "vehicle_photos_select" on storage.objects;
create policy "vehicle_photos_select" on storage.objects
for select using (
  bucket_id = 'vehicle-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "vehicle_photos_insert" on storage.objects;
create policy "vehicle_photos_insert" on storage.objects
for insert with check (
  bucket_id = 'vehicle-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "vehicle_photos_update" on storage.objects;
create policy "vehicle_photos_update" on storage.objects
for update using (
  bucket_id = 'vehicle-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "vehicle_photos_delete" on storage.objects;
create policy "vehicle_photos_delete" on storage.objects
for delete using (
  bucket_id = 'vehicle-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

commit;

