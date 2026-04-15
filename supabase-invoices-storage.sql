-- Invoice PDF storage setup
-- Run with postgres role in Supabase SQL Editor

begin;

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "invoices_storage_select" on storage.objects;
create policy "invoices_storage_select" on storage.objects
for select using (
  bucket_id = 'invoices'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "invoices_storage_insert" on storage.objects;
create policy "invoices_storage_insert" on storage.objects
for insert with check (
  bucket_id = 'invoices'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "invoices_storage_update" on storage.objects;
create policy "invoices_storage_update" on storage.objects
for update using (
  bucket_id = 'invoices'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "invoices_storage_delete" on storage.objects;
create policy "invoices_storage_delete" on storage.objects
for delete using (
  bucket_id = 'invoices'
  and auth.uid()::text = (storage.foldername(name))[1]
);

commit;
