import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/** Bucket Storage pour les photos véhicules (aligner avec Supabase Storage ; override via VITE_VEHICLE_PHOTOS_BUCKET). */
export const vehiclePhotosBucket =
  (import.meta.env.VITE_VEHICLE_PHOTOS_BUCKET as string | undefined)?.trim() ||
  'vehicle-photos'

/** Si le bucket est public (Storage → bucket → Public), les URLs d’affichage utilisent getPublicUrl au lieu des URLs signées. */
export const vehiclePhotosUsePublicUrl =
  import.meta.env.VITE_VEHICLE_PHOTOS_IS_PUBLIC === 'true'

/** Bucket Storage pour les photos de passeport client (voir supabase-client-passport-storage.sql). */
export const clientPassportPhotosBucket =
  (import.meta.env.VITE_CLIENT_PASSPORT_BUCKET as string | undefined)?.trim() ||
  'client-passport-photos'

export function buildClientPassportPhotoPath(options: {
  isPublicDemo: boolean
  userId: string
  clientId: string
  fileName: string
}): string {
  const { isPublicDemo, userId, clientId, fileName } = options
  if (isPublicDemo) {
    return `demo/${userId}/clients/${clientId}/${fileName}`
  }
  return `${userId}/clients/${clientId}/${fileName}`
}

/**
 * Clé d’objet dans le bucket (sans `/` en tête). Accepte aussi une URL complète Supabase Storage
 * si `file_path` a été copié depuis le dashboard ou une réponse API.
 */
export function parseVehiclePhotoObjectKey(raw: string): string {
  const s = raw.trim().replace(/^\/+/, '')
  if (!/^https?:\/\//i.test(s)) return s
  try {
    const u = new URL(s)
    const m = u.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|auth)\/([^/]+)\/(.+)$/,
    )
    if (m) {
      const bucket = m[1]
      const key = decodeURIComponent(m[2])
      if (bucket === vehiclePhotosBucket) return key
    }
  } catch {
    /* ignore */
  }
  return s
}

/**
 * UUID du véhicule dans le chemin :
 * - `userId/<uuid>/fichier` (création véhicule hors démo)
 * - `demo/<userId>/<uuid>/fichier` (démo publique)
 * - `userId/<slug>/fichier` (upload onglet) → pas d’UUID au segment attendu → null
 */
export function vehicleIdFromVehiclePhotoPath(path: string): string | null {
  const clean = parseVehiclePhotoObjectKey(path)
  const parts = clean.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const isDemo = parts[0] === 'demo'
  const candidate = isDemo && parts.length >= 3 ? parts[2] : parts[1]
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null
}

/** Préfixe réservé aux photos visibles par tous en démo (policies Storage `demo/`). */
export const vehiclePhotosDemoPrefix = 'demo' as const

/**
 * Chemin objet Storage pour une photo véhicule.
 * - Démo (`isPublicDemo`) : `demo/{userId}/{vehicleId}/{fichier}` → lecture ouverte (voir SQL).
 * - Sinon : `userId/{vehicleSlug ou vehicleId}/{fichier}` comme avant.
 */
export function buildVehiclePhotoStoragePath(options: {
  isPublicDemo: boolean
  userId: string
  vehicleId: string
  /** Onglet véhicule (hors démo) : dossier = slug du nom */
  vehicleSlugForTabUpload?: string
  fileName: string
}): string {
  const { isPublicDemo, userId, vehicleId, vehicleSlugForTabUpload, fileName } = options
  if (isPublicDemo) {
    return `${vehiclePhotosDemoPrefix}/${userId}/${vehicleId}/${fileName}`
  }
  if (vehicleSlugForTabUpload !== undefined) {
    return `${userId}/${vehicleSlugForTabUpload}/${fileName}`
  }
  return `${userId}/${vehicleId}/${fileName}`
}

export async function checkSupabaseConnection() {
  const { error } = await supabase.auth.getSession()

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, error: null }
}
