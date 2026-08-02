import Image from 'next/image'
import { accent, headerBg, ink, line, muted, radius, surface } from '@/app/dashboard/format'
import LoginForm from './LoginForm'

// Habillage visuel uniquement — le formulaire (LoginForm.tsx) reste branché
// sur la même Server Action login() (actions.ts, non modifiée) : mêmes
// champs, mêmes validations, même redirection. Palette/rayons/ombres
// réutilisent les tokens de app/dashboard/format.ts (aucune couleur inventée).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: `linear-gradient(135deg, ${headerBg} 0%, ${accent} 140%)`,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: surface,
          borderRadius: radius,
          border: `1px solid ${line}`,
          boxShadow: '0 24px 60px rgba(15, 16, 30, 0.35)',
          padding: '40px 32px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: headerBg,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Image src="/amerys-icon.png" alt="Amerys" width={32} height={28} style={{ display: 'block' }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 19, color: ink, letterSpacing: '.01em' }}>AMERYS ADS</div>
            <div style={{ fontSize: 12.5, color: muted, marginTop: 2 }}>Marketing Dashboard</div>
          </div>
        </div>

        <h1 style={{ fontWeight: 700, fontSize: 20, color: ink, textAlign: 'center', margin: 0 }}>Connexion</h1>
        <p style={{ fontSize: 13, color: muted, textAlign: 'center', marginTop: 4, marginBottom: 26 }}>
          Accédez à vos résultats de campagnes.
        </p>

        <LoginForm error={error ?? null} />
      </div>
    </main>
  )
}
