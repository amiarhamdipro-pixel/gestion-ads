'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logger'

export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')

  if (password.length < 6) {
    redirect('/update-password?error=' + encodeURIComponent('Le mot de passe doit contenir au moins 6 caractères.'))
  }
  if (password !== confirmPassword) {
    redirect('/update-password?error=' + encodeURIComponent('Les mots de passe ne correspondent pas.'))
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(
      '/login?error=' + encodeURIComponent('Session expirée. Merci de refaire une demande de réinitialisation.')
    )
  }

  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    logError('critical', 'update-password', error.message)
    redirect('/update-password?error=' + encodeURIComponent('Impossible de mettre à jour le mot de passe. Réessayez.'))
  }

  redirect('/dashboard')
}
