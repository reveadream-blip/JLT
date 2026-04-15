import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function checkSupabaseConnection() {
  const { error } = await supabase.auth.getSession()

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, error: null }
}
