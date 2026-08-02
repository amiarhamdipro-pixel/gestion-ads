'use client'

// Filet indispensable, pas cosmétique : ce projet Supabase délivre les liens
// de récupération de mot de passe au format historique (jetons dans le
// FRAGMENT d'URL, `#access_token=...&refresh_token=...&type=recovery`),
// jamais transmis au serveur — confirmé en conditions réelles en générant un
// vrai lien (auth.admin.generateLink) et en suivant la redirection réelle de
// Supabase. app/auth/confirm/route.ts (format `?code=`, flux PKCE) ne reçoit
// donc jamais rien : sans ce composant, le parcours de réinitialisation ne
// fonctionne jamais, quelle que soit la configuration de NEXT_PUBLIC_SITE_URL.
//
// Le fragment atterrit sur /login car Supabase redirige vers l'origine du
// site (redirectTo non présent dans l'allow-list Supabase → repli sur
// l'URL racine) puis app/page.tsx redirige (côté serveur) vers /login — un
// fragment sans équivalent dans l'en-tête Location d'une redirection est
// conservé par le navigateur (comportement standard), donc il survit aux
// deux sauts et arrive ici intact.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function RecoveryHashHandler() {
  const router = useRouter()

  useEffect(() => {
    if (!window.location.hash) return
    const params = new URLSearchParams(window.location.hash.slice(1))

    // Lien invalide/expiré/déjà utilisé : Supabase renvoie l'erreur dans le
    // même fragment (ex. error_code=otp_expired) plutôt que des jetons —
    // confirmé en conditions réelles. Message générique et propre, jamais
    // le code technique brut.
    if (params.get('error')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      router.replace(
        '/login?error=' + encodeURIComponent('Lien invalide ou expiré. Merci de refaire une demande de réinitialisation.')
      )
      return
    }

    if (params.get('type') !== 'recovery') return

    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) return

    // Retire immédiatement les jetons de l'URL visible/historique.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)

    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (!error) {
          router.replace('/update-password')
          return
        }
        router.replace(
          '/login?error=' + encodeURIComponent('Lien invalide ou expiré. Merci de refaire une demande de réinitialisation.')
        )
      })
  }, [router])

  return null
}
