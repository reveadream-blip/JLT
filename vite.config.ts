import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    injectRegister: null,
    includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png', 'apple-touch-icon.png'],
    manifest: {
      name: 'JLT — Just Lease Tech',
      short_name: 'JLT',
      description:
        'Plateforme de gestion pour loueurs : flotte, contrats, clients, révisions et suivi.',
      theme_color: '#081738',
      background_color: '#f5f6fa',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui', 'browser'],
      orientation: 'any',
      scope: '/',
      start_url: '/app/dashboard',
      id: '/',
      lang: 'fr',
      categories: ['business', 'productivity'],
      icons: [
        {
          src: '/pwa-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/pwa-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/pwa-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [
        /^\/api\//,
        // Ne jamais intercepter les appels Supabase (auth, REST, Storage,
        // Edge Functions). Sinon le SW peut servir une vieille reponse en
        // cache ou renvoyer ERR_INTERNET_DISCONNECTED sur des endpoints
        // qui n'existaient pas a la version precedente.
        /^https?:\/\/[^/]+\.supabase\.co\//,
      ],
      // Force le nouveau SW a prendre le controle immediatement, sans
      // attendre que tous les onglets soient fermes. Indispensable pour
      // que les correctifs deployes soient effectifs des le rechargement
      // suivant chez les utilisateurs deja installes.
      clientsClaim: true,
      skipWaiting: true,
      cleanupOutdatedCaches: true,
      // Ne jamais mettre en cache les requetes vers les domaines
      // d'API externes (Supabase, Stripe). On laisse le navigateur
      // les gerer directement.
      navigationPreload: false,
    },
    devOptions: {
      enabled: false,
    },
  }), cloudflare()],
})