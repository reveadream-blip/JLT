-- JLT — Seed des données démo pour visiteurs anonymes
-- Chaque visiteur en mode démo (signInAnonymously) obtient sa propre copie
-- isolée : on écrit tout sous son auth.uid(). Les RLS existantes continuent
-- de fonctionner à l'identique (owner_id = auth.uid()).
--
-- Idempotent : si le user a déjà au moins un véhicule, la fonction sort.
-- Lorsque le visiteur démo s'inscrit via supabase.auth.updateUser({ email, password }),
-- son auth.uid() est conservé → toutes ces données le suivent dans son compte.
--
-- À exécuter UNE fois dans Supabase SQL Editor (project xaplhaibffgxwjaavspz).

begin;

create or replace function public.seed_demo_data_if_empty()
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_user        uuid := auth.uid();
  v_scooter     uuid;
  v_yaris       uuid;
  v_fortuner    uuid;
  v_client_emma uuid;
  v_client_marc uuid;
begin
  if v_user is null then
    return;
  end if;

  -- Idempotence : ne rien faire si le user a déjà des données
  if exists (select 1 from public.vehicles where owner_id = v_user limit 1) then
    return;
  end if;

  -- ================= Vehicles =================
  insert into public.vehicles
    (owner_id, type, brand, model, license_plate, year, daily_price, status, notes)
  values
    (v_user, 'scooter', 'Honda', 'PCX 150', '9กก1234', 2023, 350, 'available', 'Démo — scooter urbain')
  returning id into v_scooter;

  insert into public.vehicles
    (owner_id, type, brand, model, license_plate, year, daily_price, status, notes)
  values
    (v_user, 'car', 'Toyota', 'Yaris', '4กข5678', 2022, 1200, 'reserved', 'Démo — citadine automatique')
  returning id into v_yaris;

  insert into public.vehicles
    (owner_id, type, brand, model, license_plate, year, daily_price, status, notes)
  values
    (v_user, 'car', 'Toyota', 'Fortuner', '7ขค9012', 2024, 2500, 'available', 'Démo — SUV 7 places')
  returning id into v_fortuner;

  -- ================= Clients =================
  insert into public.clients
    (owner_id, full_name, nationality, phone, email, passport_number, deposit_amount, notes)
  values
    (v_user, 'Emma Laurent', 'FR', '+33 6 12 34 56 78', 'emma.laurent@example.com', 'FR123456', 5000, 'Démo — cliente fidèle')
  returning id into v_client_emma;

  insert into public.clients
    (owner_id, full_name, nationality, phone, email, passport_number, deposit_amount, notes)
  values
    (v_user, 'Marco Rossi', 'IT', '+39 348 123 4567', 'marco.rossi@example.com', 'IT789012', 8000, 'Démo — séjour 10 jours')
  returning id into v_client_marc;

  -- ================= Contracts =================
  insert into public.contracts
    (owner_id, client_id, vehicle_id, client_name, vehicle_label, start_at, end_at, total_price, status)
  values
    (v_user, v_client_emma, v_scooter, 'Emma Laurent', 'Honda PCX 150',
     now() - interval '1 day', now() + interval '2 days', 1050, 'active'),
    (v_user, v_client_marc, v_yaris,   'Marco Rossi',  'Toyota Yaris',
     now() + interval '3 days', now() + interval '8 days', 6000, 'draft');

  -- ================= Pricing =================
  insert into public.pricing_plans (owner_id, label, vehicle_type, day_rate, week_rate, month_rate)
  values
    (v_user, 'Tarif standard Motos', 'scooter',  350,  2000,  7500),
    (v_user, 'Tarif Voitures',       'car',     1200,  6500, 24000);
end;
$$;

revoke all on function public.seed_demo_data_if_empty() from public;
grant execute on function public.seed_demo_data_if_empty() to anon, authenticated;

commit;
