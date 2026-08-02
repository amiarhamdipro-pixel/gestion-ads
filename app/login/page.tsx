import AuthShell from '@/app/AuthShell'
import LoginForm from './LoginForm'
import RecoveryHashHandler from './RecoveryHashHandler'

// Habillage visuel uniquement — le formulaire (LoginForm.tsx) reste branché
// sur la même Server Action login() (actions.ts, non modifiée) : mêmes
// champs, mêmes validations, même redirection. RecoveryHashHandler capte le
// jeton de récupération de mot de passe si le lien Supabase atterrit ici
// (voir ce fichier pour le détail) — n'affiche rien, silencieux si absent.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <AuthShell title="Connexion" subtitle="Accédez à vos résultats de campagnes.">
      <RecoveryHashHandler />
      <LoginForm error={error ?? null} />
    </AuthShell>
  )
}
