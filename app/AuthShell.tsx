import Image from 'next/image'
import { accent, headerBg, ink, line, muted, radius, surface } from './dashboard/format'

// Habillage partagé par /login, /forgot-password et /update-password : même
// carte, même arrière-plan, même bloc logo — un seul endroit à faire
// évoluer si le thème change. Palette reprise de app/dashboard/format.ts.
export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
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

        <h1 style={{ fontWeight: 700, fontSize: 20, color: ink, textAlign: 'center', margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 13, color: muted, textAlign: 'center', marginTop: 4, marginBottom: 26 }}>{subtitle}</p>

        {children}
      </div>
    </main>
  )
}
