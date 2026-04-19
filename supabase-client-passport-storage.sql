-- Photos passeport clients : bucket dédié + RLS (prod : userId/... ; démo : demo/userId/...).
-- Exécuter dans Supabase SQL Editor après les colonnes clients (voir supabase-update.sql).

begin;

insert into storage.buckets (id, name, public)
values ('client-passport-photos', 'client-passport-photos', false)
on conflict (id) do nothing;

drop policy if exists "client_passport_select" on storage.objects;
create policy "client_passport_select" on storage.objects
for select using (
  bucket_id = 'client-passport-photos'
  and (
    (auth.uid() is not null and auth.uid()::text = (storage.foldername(name))[1])
    or (
      (storage.foldername(name))[1] = 'demo'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

drop policy if exists "client_passport_insert" on storage.objects;
create policy "client_passport_insert" on storage.objects
for insert with check (
  bucket_id = 'client-passport-photos'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or (
      (storage.foldername(name))[1] = 'demo'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

drop policy if exists "client_passport_update" on storage.objects;
create policy "client_passport_update" on storage.objects
for update using (
  bucket_id = 'client-passport-photos'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or (
      (storage.foldername(name))[1] = 'demo'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

drop policy if exists "client_passport_delete" on storage.objects;
create policy "client_passport_delete" on storage.objects
for delete using (
  bucket_id = 'client-passport-photos'
  and (
    auth.uid()::text = (storage.foldername(name))[1]
    or (
      (storage.foldername(name))[1] = 'demo'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

commit;
