-- Harmonize contracts schema (idempotent)
-- Run with postgres role in Supabase SQL Editor

begin;

-- Base columns expected by app
alter table public.contracts add column if not exists owner_id uuid;
alter table public.contracts add column if not exists client_id uuid;
alter table public.contracts add column if not exists vehicle_id uuid;
alter table public.contracts add column if not exists client_name text;
alter table public.contracts add column if not exists vehicle_label text;
alter table public.contracts add column if not exists start_at timestamptz;
alter table public.contracts add column if not exists end_at timestamptz;
alter table public.contracts add column if not exists total_price numeric(10,2) default 0;
alter table public.contracts add column if not exists status text default 'draft';
alter table public.contracts add column if not exists created_at timestamptz default now();

-- Fill missing text fields from relations
update public.contracts c
set client_name = cl.full_name
from public.clients cl
where c.client_id = cl.id
  and (c.client_name is null or btrim(c.client_name) = '');

update public.contracts c
set vehicle_label = concat_ws(' ', v.brand, v.model)
from public.vehicles v
where c.vehicle_id = v.id
  and (c.vehicle_label is null or btrim(c.vehicle_label) = '');

-- Ensure foreign keys exist
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contracts_client_id_fkey'
      and conrelid = 'public.contracts'::regclass
  ) then
    alter table public.contracts
      add constraint contracts_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'contracts_vehicle_id_fkey'
      and conrelid = 'public.contracts'::regclass
  ) then
    alter table public.contracts
      add constraint contracts_vehicle_id_fkey
      foreign key (vehicle_id) references public.vehicles(id) on delete set null;
  end if;
end $$;

-- Normalize status values
update public.contracts
set status = 'done'
where status = 'completed';

alter table public.contracts
  drop constraint if exists contracts_status_check;
alter table public.contracts
  add constraint contracts_status_check
  check (status in ('draft', 'active', 'done', 'cancelled'));

create index if not exists idx_contracts_owner_id on public.contracts(owner_id);
create index if not exists idx_contracts_client_id on public.contracts(client_id);
create index if not exists idx_contracts_vehicle_id on public.contracts(vehicle_id);

commit;
