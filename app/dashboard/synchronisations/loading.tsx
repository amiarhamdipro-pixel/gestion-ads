import { line, muted, radius, surface } from '../format'

// État de chargement de /dashboard/synchronisations (convention Next.js :
// affiché pendant le rendu serveur de page.tsx).
export default function SynchronisationsLoading() {
  return (
    <main style={{ padding: '40px 40px 64px' }}>
      <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Synchronisations</h1>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Historique des synchronisations manuelles Meta + Calendly</p>
      <div
        role="status"
        style={{
          marginTop: 24,
          background: surface,
          border: `1px solid ${line}`,
          borderRadius: radius,
          padding: 28,
          textAlign: 'center',
          fontSize: 13.5,
          color: muted,
        }}
      >
        Chargement de l’historique…
      </div>
    </main>
  )
}
