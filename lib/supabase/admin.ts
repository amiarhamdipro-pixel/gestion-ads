import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Client service role : ne jamais importer depuis un composant client ("use client")
// ni exposer SUPABASE_SERVICE_ROLE_KEY via NEXT_PUBLIC_*.
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient ne doit être appelé que côté serveur.')
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.'
    )
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
