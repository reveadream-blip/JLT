-- Photos véhicules : démo publique (préfixe demo/) lisible par tous, production = uniquement le propriétaire.
-- À exécuter dans Supabase SQL Editor après création du bucket vehicle-photos.
-- L’app en VITE_PUBLIC_DEMO_MODE=true envoie les fichiers sous demo/{auth.uid()}/{vehicle_id}/...

-- Remplace les policies existantes du bucket vehicle-photos
drop policy if exists "vehicle_photos_bucket_select" on storage.objects;
drop policy if exists "vehicle_photos_bucket_insert" on storage.objects;
drop policy if exists "vehicle_photos_bucket_update" on storage.objects;
drop policy if exists "vehicle_photos_bucket_delete" on storage.objects;

-- SELECT : fichiers perso (1er dossier = user id) OU tout ce qui est sous demo/ (visitable sans compte ou entre visiteurs démo)
create policy "vehicle_photos_bucket_select" on storage.objects
for select using (
  bucket_id = 'vehicle-photos'
  and (
    (auth.uid() is not null and auth.uid()::text = (storage.foldername(name))[1])
    or (storage.foldername(name))[1] = 'demo'
  )
);

-- INSERT : soit chemin classique userId/..., soit demo/{mon user id}/...
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
