-- Client logos for invoice PDFs
-- Run with postgres role in Supabase SQL Editor

begin;

create table if not exists public.client_logos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  file_path text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, client_id)
);

create index if not exists idx_client_logos_owner_id on public.client_logos(owner_id);
create index if not exists idx_client_logos_client_id on public.client_logos(client_id);

alter table public.client_logos enable row level security;

drop policy if exists "client_logos_owner_all" on public.client_logos;
create policy "client_logos_owner_all" on public.client_logos
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('client-logos', 'client-logos', false)
on conflict (id) do nothing;

drop policy if exists "client_logos_storage_select" on storage.objects;
create policy "client_logos_storage_select" on storage.objects
for select using (
  bucket_id = 'client-logos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "client_logos_storage_insert" on storage.objects;
create policy "client_logos_storage_insert" on storage.objects
for insert with check (
  bucket_id = 'client-logos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "client_logos_storage_update" on storage.objects;
create policy "client_logos_storage_update" on storage.objects
for update using (
  bucket_id = 'client-logos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "client_logos_storage_delete" on storage.objects;
create policy "client_logos_storage_delete" on storage.objects
for delete using (
  bucket_id = 'client-logos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

commit;
