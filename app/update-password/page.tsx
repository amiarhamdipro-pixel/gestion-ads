import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AuthShell from '@/app/AuthShell'
import UpdatePasswordForm from './UpdatePasswordForm'

// Accessible uniquement avec une session active — établie soit par
// app/login/RecoveryHashHandler.tsx (jetons dans le fragment d'URL, format
// actuellement délivré par ce projet Supabase pour la réinitialisation),
// soit par app/auth/confirm/route.ts (format `?code=`, si jamais utilisé) —
// même garde que le reste de l'app (auth.getUser() + redirect si absent).
export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <AuthShell title="Nouveau mot de passe" subtitle="Choisissez un nouveau mot de passe pour votre compte.">
      <UpdatePasswordForm error={error ?? null} />
    </AuthShell>
  )
}
