import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AuthShell from '@/app/AuthShell'
import UpdatePasswordForm from './UpdatePasswordForm'

// Accessible uniquement avec une session active (établie par
// app/auth/confirm/route.ts depuis le lien reçu par e-mail) — même garde
// que le reste de l'app (auth.getUser() + redirect si absent).
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
