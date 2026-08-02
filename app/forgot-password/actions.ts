'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logger'
import { SITE_URL } from '@/lib/site'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()

  if (!EMAIL_PATTERN.test(email)) {
    redirect('/forgot-password?error=' + encodeURIComponent('Adresse e-mail invalide.'))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/update-password`,
  })

  // Supabase ne révèle jamais si l'adresse existe (protection contre
  // l'énumération de comptes) : une erreur ici est un vrai problème
  // technique (ex. limite de débit), jamais "compte introuvable".
  if (error) {
    logError('critical', 'forgot-password', error.message)
    redirect(
      '/forgot-password?error=' +
        encodeURIComponent("Impossible d'envoyer l'e-mail pour le moment. Réessayez plus tard.")
    )
  }

  redirect('/forgot-password?sent=1')
}
