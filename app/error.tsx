'use client'

// Limite d'erreur (App Router) : capte toute exception non gérée dans une
// route et affiche un message propre au lieu de l'écran d'erreur par défaut
// de Next.js (jamais de stack trace ni de message technique brut affiché).
// L'erreur elle-même reste visible côté navigateur (console devtools,
// comportement natif React) — aucune donnée personnelle/secrète n'y transite
// depuis ce composant.

import Link from 'next/link'
import { accent, headerBg, ink, line, muted, radius, surface } from './dashboard/format'

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
          maxWidth: 420,
          background: surface,
          borderRadius: radius,
          border: `1px solid ${line}`,
          boxShadow: '0 24px 60px rgba(15, 16, 30, 0.35)',
          padding: '40px 32px',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontWeight: 700, fontSize: 20, color: ink, margin: 0 }}>Une erreur est survenue</h1>
        <p style={{ fontSize: 13, color: muted, marginTop: 8, marginBottom: 24 }}>
          Réessayez, ou revenez au tableau de bord.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: 999,
              padding: '10px 18px',
              fontSize: 13.5,
              fontWeight: 700,
              color: '#FFFFFF',
              background: accent,
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
          <Link
            href="/dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 13.5,
              fontWeight: 600,
              color: accent,
              textDecoration: 'none',
            }}
          >
            Tableau de bord
          </Link>
        </div>
      </div>
    </main>
  )
}
