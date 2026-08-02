'use server'

// Server Action, jamais exposée en dehors de ce formulaire admin. Le rôle
// admin est revérifié ici côté serveur (jamais confiance dans le seul garde
// d'affichage de page.tsx) — une Server Action est un point d'entrée public
// au même titre qu'une route API. createAdminClient() (service_role) n'est
// utilisé qu'après cette vérification, jamais avant.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types/database'

export type CreateUserState = { status: 'idle' } | { status: 'success'; email: string } | { status: 'error'; message: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function createUser(_prevState: CreateUserState, formData: FormData): Promise<CreateUserState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { status: 'error', message: 'Authentification requise.' }
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return { status: 'error', message: 'Accès réservé aux administrateurs.' }
  }

  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const role = String(formData.get('role') ?? '')
  const clientId = String(formData.get('clientId') ?? '')

  if (!EMAIL_PATTERN.test(email)) {
    return { status: 'error', message: 'E-mail invalide.' }
  }
  if (!password) {
    return { status: 'error', message: 'Mot de passe temporaire requis.' }
  }
  if (role !== 'admin' && role !== 'client') {
    return { status: 'error', message: 'Rôle invalide.' }
  }
  if (!clientId) {
    return { status: 'error', message: 'Client requis.' }
  }

  const adminSupabase = createAdminClient()

  // Existence du client vérifiée avant tout appel Auth : évite de créer un
  // compte Auth pour un clientId invalide (mieux vaut échouer tôt que devoir
  // annuler après coup).
  const { data: client, error: clientError } = await adminSupabase.from('clients').select('id').eq('id', clientId).maybeSingle()
  if (clientError || !client) {
    return { status: 'error', message: 'Client introuvable.' }
  }

  const { data: created, error: createError } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !created.user) {
    return { status: 'error', message: createError?.message ?? 'Échec de la création du compte.' }
  }

  const { error: profileError } = await adminSupabase.from('profiles').insert({
    id: created.user.id,
    client_id: clientId,
    role: role as UserRole,
    full_name: null,
  })

  if (profileError) {
    // Anti-compte orphelin : le profil n'a pas pu être créé, le compte Auth
    // fraîchement créé est supprimé immédiatement plutôt que laissé sans profil.
    await adminSupabase.auth.admin.deleteUser(created.user.id)
    return { status: 'error', message: `Échec de la création du profil (compte annulé) : ${profileError.message}` }
  }

  revalidatePath('/dashboard/admin/users')
  return { status: 'success', email }
}
