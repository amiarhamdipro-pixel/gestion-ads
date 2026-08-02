import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logger'

// Point d'entrée unique pour les liens envoyés par Supabase Auth (e-mail de
// réinitialisation de mot de passe pour l'instant — aucune inscription
// publique dans ce projet). Échange le code contre une session (cookies)
// puis redirige vers `next`. Ne modifie ni RLS ni schéma : utilise le même
// createClient() que le reste de l'app.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    logError('critical', 'auth/confirm', error.message)
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Lien invalide ou expiré. Merci de refaire la demande.')}`
  )
}
