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

/** UUID du véhicule dans le chemin `userId/<uuid>/fichier` (upload à la création). */
export function vehicleIdFromVehiclePhotoPath(path: string): string | null {
  const clean = parseVehiclePhotoObjectKey(path)
  const parts = clean.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const seg = parts[1]
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
    ? seg
    : null
}

export async function checkSupabaseConnection() {
  const { error } = await supabase.auth.getSession()

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, error: null }
}
