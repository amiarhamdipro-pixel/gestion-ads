import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logger'
import { SITE_URL } from '@/lib/site'

// Point d'entrée unique pour les liens envoyés par Supabase Auth (e-mail de
// réinitialisation de mot de passe pour l'instant — aucune inscription
// publique dans ce projet). Échange le code contre une session (cookies)
// puis redirige vers `next`. Ne modifie ni RLS ni schéma : utilise le même
// createClient() que le reste de l'app.
//
// Redirections construites à partir de SITE_URL (lib/site.ts), jamais de
// l'origin déduit de request.url : ce dernier reflète l'hôte sur lequel la
// requête a été REÇUE (ex. 0.0.0.0 si le lien e-mail lui-même pointait vers
// une adresse d'écoute non navigable, ou tout hôte imprévu derrière un
// proxy), pas nécessairement une adresse valide à renvoyer au navigateur —
// cause racine constatée du bug ERR_ADDRESS_INVALID sur le lien de
// réinitialisation. SITE_URL est la seule source de vérité pour ces liens,
// déjà appliquée côté envoi (app/forgot-password/actions.ts,
// admin/users/actions.ts).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${SITE_URL}${next}`)
    }
    logError('critical', 'auth/confirm', error.message)
  }

  return NextResponse.redirect(
    `${SITE_URL}/login?error=${encodeURIComponent('Lien invalide ou expiré. Merci de refaire la demande.')}`
  )
}
