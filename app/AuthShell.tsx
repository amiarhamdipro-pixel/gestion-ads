import Image from 'next/image'
import { BRAND_ICON_ALT, BRAND_ICON_SRC, BRAND_NAME, BRAND_SUBTITLE } from './brand'
import { fullscreenBg, ink, line, muted, radius, shadow, surface } from './dashboard/format'

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
        background: fullscreenBg,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: surface,
          borderRadius: radius,
          border: `1px solid ${line}`,
          boxShadow: shadow,
          padding: '40px 32px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          {/* Symbole officiel Amerys (kit 2026) : badge circulaire autonome
              (fond sombre intégré), mêmes dimensions que l'ancien bloc logo
              (56 px), centré au-dessus du nom. Chargement immédiat : visible
              dès l'arrivée sur la page. */}
          <Image
            src={BRAND_ICON_SRC}
            alt={BRAND_ICON_ALT}
            width={56}
            height={56}
            loading="eager"
            style={{ display: 'block', width: 56, height: 56, borderRadius: '50%', flexShrink: 0 }}
          />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 650, fontSize: 19, color: ink, letterSpacing: '.02em' }}>{BRAND_NAME}</div>
            <div style={{ fontSize: 12.5, color: muted, marginTop: 2 }}>{BRAND_SUBTITLE}</div>
          </div>
        </div>

        <h1 style={{ fontWeight: 600, fontSize: 20, color: ink, textAlign: 'center', margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 13, color: muted, textAlign: 'center', marginTop: 4, marginBottom: 26 }}>{subtitle}</p>

        {children}
      </div>
    </main>
  )
}
