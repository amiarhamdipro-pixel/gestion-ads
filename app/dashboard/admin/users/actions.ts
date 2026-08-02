'use server'

// Server Actions, jamais exposées en dehors de ce formulaire admin. Le rôle
// admin est revérifié ici côté serveur (jamais confiance dans le seul garde
// d'affichage de page.tsx) — une Server Action est un point d'entrée public
// au même titre qu'une route API. createAdminClient() (service_role) n'est
// utilisé qu'après cette vérification, jamais avant.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logError } from '@/lib/logger'
import { SITE_URL } from '@/lib/site'
import type { UserRole } from '@/types/database'

export type CreateUserState = { status: 'idle' } | { status: 'success'; email: string } | { status: 'error'; message: string }
export type UserActionState = { status: 'idle' } | { status: 'success'; message: string } | { status: 'error'; message: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PERMANENT_BAN_DURATION = '87600h' // ~10 ans — pas de suppression, juste une désactivation réversible.

async function requireAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; message: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, message: 'Authentification requise.' }
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return { ok: false, message: 'Accès réservé aux administrateurs.' }
  }

  return { ok: true, adminId: user.id }
}

export async function createUser(_prevState: CreateUserState, formData: FormData): Promise<CreateUserState> {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return { status: 'error', message: admin.message }
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
    logError('critical', 'admin/users createUser', createError?.message ?? 'échec inconnu')
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
    logError('critical', 'admin/users createUser', `profil : ${profileError.message}`)
    return { status: 'error', message: `Échec de la création du profil (compte annulé) : ${profileError.message}` }
  }

  revalidatePath('/dashboard/admin/users')
  return { status: 'success', email }
}

export async function deleteUser(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return { status: 'error', message: admin.message }
  }

  const userId = String(formData.get('userId') ?? '')
  if (!userId) {
    return { status: 'error', message: 'Utilisateur invalide.' }
  }
  if (userId === admin.adminId) {
    return { status: 'error', message: 'Vous ne pouvez pas supprimer votre propre compte.' }
  }

  const adminSupabase = createAdminClient()
  const { error } = await adminSupabase.auth.admin.deleteUser(userId)
  if (error) {
    logError('critical', 'admin/users deleteUser', error.message)
    return { status: 'error', message: 'Échec de la suppression du compte.' }
  }

  revalidatePath('/dashboard/admin/users')
  return { status: 'success', message: 'Compte supprimé.' }
}

export async function resetUserPassword(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return { status: 'error', message: admin.message }
  }

  const email = String(formData.get('email') ?? '').trim()
  if (!EMAIL_PATTERN.test(email)) {
    return { status: 'error', message: 'Utilisateur invalide.' }
  }

  const adminSupabase = createAdminClient()
  const { error } = await adminSupabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/update-password`,
  })
  if (error) {
    logError('critical', 'admin/users resetUserPassword', error.message)
    return { status: 'error', message: "Impossible d'envoyer l'e-mail pour le moment." }
  }

  return { status: 'success', message: 'E-mail de réinitialisation envoyé.' }
}

export async function toggleUserBan(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return { status: 'error', message: admin.message }
  }

  const userId = String(formData.get('userId') ?? '')
  const currentlyBanned = String(formData.get('banned') ?? '') === 'true'
  if (!userId) {
    return { status: 'error', message: 'Utilisateur invalide.' }
  }
  if (userId === admin.adminId) {
    return { status: 'error', message: 'Vous ne pouvez pas désactiver votre propre compte.' }
  }

  const adminSupabase = createAdminClient()
  const { error } = await adminSupabase.auth.admin.updateUserById(userId, {
    ban_duration: currentlyBanned ? 'none' : PERMANENT_BAN_DURATION,
  })
  if (error) {
    logError('critical', 'admin/users toggleUserBan', error.message)
    return { status: 'error', message: 'Échec de la mise à jour du compte.' }
  }

  revalidatePath('/dashboard/admin/users')
  return { status: 'success', message: currentlyBanned ? 'Compte réactivé.' : 'Compte désactivé.' }
}
