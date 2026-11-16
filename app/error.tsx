'use client'

// Limite d'erreur (App Router) : capte toute exception non gérée dans une
// route et affiche un message propre au lieu de l'écran d'erreur par défaut
// de Next.js (jamais de stack trace ni de message technique brut affiché).
// L'erreur elle-même reste visible côté navigateur (console devtools,
// comportement natif React) — aucune donnée personnelle/secrète n'y transite
// depuis ce composant.

import Link from 'next/link'
import { accent, buttonLight, buttonLightText, fullscreenBg, ink, line, muted, radius, radiusButton, shadow, surface } from './dashboard/format'

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
          maxWidth: 420,
          background: surface,
          borderRadius: radius,
          border: `1px solid ${line}`,
          boxShadow: shadow,
          padding: '40px 32px',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontWeight: 600, fontSize: 20, color: ink, margin: 0 }}>Une erreur est survenue</h1>
        <p style={{ fontSize: 13, color: muted, marginTop: 8, marginBottom: 24 }}>
          Réessayez, ou revenez au tableau de bord.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: radiusButton,
              minHeight: 44,
              padding: '0 18px',
              fontSize: 13.5,
              fontWeight: 650,
              color: buttonLightText,
              background: buttonLight,
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
