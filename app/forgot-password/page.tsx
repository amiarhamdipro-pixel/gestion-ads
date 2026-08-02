import Link from 'next/link'
import AuthShell from '@/app/AuthShell'
import { accent, muted } from '@/app/dashboard/format'
import { AuthSuccessMessage } from '@/app/auth-ui'
import ForgotPasswordForm from './ForgotPasswordForm'

const backLinkStyle = { fontSize: 12.5, fontWeight: 600, color: accent, textDecoration: 'none' } as const

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const { error, sent } = await searchParams

  if (sent) {
    return (
      <AuthShell title="E-mail envoyé" subtitle="">
        <AuthSuccessMessage>
          Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d&apos;être envoyé. Vérifiez
          votre boîte de réception (et vos spams).
        </AuthSuccessMessage>
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href="/login" style={backLinkStyle}>
            ← Retour à la connexion
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Mot de passe oublié" subtitle="Recevez un lien pour réinitialiser votre mot de passe.">
      <ForgotPasswordForm error={error ?? null} />
      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12.5, color: muted }}>
        <Link href="/login" style={backLinkStyle}>
          ← Retour à la connexion
        </Link>
      </div>
    </AuthShell>
  )
}
