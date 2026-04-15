/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Si "true" : démo publique (connexion anonyme + mode test forcé, sans abonnement). À activer sur Netlify pour les démos. */
  readonly VITE_PUBLIC_DEMO_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
