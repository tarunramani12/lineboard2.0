import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

// Only the public URL and publishable key are used here. Permissions are enforced by the database.
export const supabase = createClient(url || 'http://localhost', key || 'missing-key')
