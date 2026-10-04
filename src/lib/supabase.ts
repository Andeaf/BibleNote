import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** False when the env vars are missing; main.tsx shows a configuration screen instead of the app. */
export const isSupabaseConfigured = Boolean(url && key)

/**
 * The single Supabase client. Only the sync engine, auth and lib/storage may use it;
 * UI components read Dexie.
 */
export const supabase = createClient<Database>(url ?? 'http://localhost', key ?? 'missing', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
