'use client'

// Dernier filet de sécurité (App Router) : ne se déclenche que si le layout
// racine lui-même plante. Remplace tout le document (html/body inclus),
// donc volontairement autonome — aucune dépendance au reste de l'app pour
// rester fiable même si ce qui a cassé le layout racine affecte aussi ses
// imports partagés. Valeurs de couleur de la charte Amerys (thème nuit,
// app/globals.css) dupliquées à dessein, pas importées : ce document ne
// charge ni globals.css ni les variables de thème.

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
          fontFamily: 'Arial, sans-serif',
          background: '#09070E',
          color: '#F5F0F8',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            background: '#15101B',
            border: '1px solid rgba(255, 255, 255, 0.094)',
            borderRadius: 18,
            padding: '40px 32px',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontWeight: 700, fontSize: 19, color: '#F5F0F8', margin: 0, letterSpacing: '.02em' }}>
            AMERYS ADS
          </h1>
          <p style={{ fontSize: 13, color: '#DDD2E2', marginTop: 10, marginBottom: 24 }}>
            Une erreur inattendue est survenue. Merci de réessayer.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: 9,
              minHeight: 44,
              padding: '0 20px',
              fontSize: 13.5,
              fontWeight: 650,
              color: '#24142D',
              background: '#F1E7F7',
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
