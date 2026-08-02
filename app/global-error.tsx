'use client'

// Dernier filet de sécurité (App Router) : ne se déclenche que si le layout
// racine lui-même plante. Remplace tout le document (html/body inclus),
// donc volontairement autonome — aucune dépendance au reste de l'app pour
// rester fiable même si ce qui a cassé le layout racine affecte aussi ses
// imports partagés. Valeurs de couleur dupliquées de app/dashboard/format.ts
// à dessein, pas importées.

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'sans-serif',
          background: 'linear-gradient(135deg, #1E1B4B 0%, #4F46E5 140%)',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            background: '#FFFFFF',
            borderRadius: 16,
            padding: '40px 32px',
            textAlign: 'center',
            boxShadow: '0 24px 60px rgba(15, 16, 30, 0.35)',
          }}
        >
          <h1 style={{ fontWeight: 700, fontSize: 19, color: '#16172E', margin: 0, letterSpacing: '.01em' }}>
            AMERYS ADS
          </h1>
          <p style={{ fontSize: 13, color: '#71748C', marginTop: 10, marginBottom: 24 }}>
            Une erreur inattendue est survenue. Merci de réessayer.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: 999,
              padding: '10px 20px',
              fontSize: 13.5,
              fontWeight: 700,
              color: '#FFFFFF',
              background: '#4F46E5',
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  )
}
