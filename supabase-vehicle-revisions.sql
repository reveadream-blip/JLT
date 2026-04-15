-- Vehicle revisions module setup
-- Run with postgres role in Supabase SQL Editor

begin;

create table if not exists public.vehicle_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  due_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'overdue')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_revisions_owner_id on public.vehicle_revisions(owner_id);
create index if not exists idx_vehicle_revisions_vehicle_id on public.vehicle_revisions(vehicle_id);
create index if not exists idx_vehicle_revisions_due_date on public.vehicle_revisions(due_date);

alter table public.vehicle_revisions enable row level security;

drop policy if exists "vehicle_revisions_owner_all" on public.vehicle_revisions;
create policy "vehicle_revisions_owner_all" on public.vehicle_revisions
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

commit;
