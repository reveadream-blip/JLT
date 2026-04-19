/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /**
   * Si "true" : démo publique (connexion anonyme + mode test forcé, sans abonnement).
   * Les photos véhicules sont stockées sous `demo/{userId}/...` (lecture ouverte côté Storage — voir SQL).
   * Production abonnés : `VITE_PUBLIC_DEMO_MODE=false` → chemins `userId/...` uniquement accessibles au propriétaire.
   */
  readonly VITE_PUBLIC_DEMO_MODE?: string
  /** Override du bucket Storage pour les photos véhicules (défaut : vehicle-photos). */
  readonly VITE_VEHICLE_PHOTOS_BUCKET?: string
  /** Si "true" : bucket vehicle-photos en lecture publique → affichage via getPublicUrl (pas d’URL signée). */
  readonly VITE_VEHICLE_PHOTOS_IS_PUBLIC?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
