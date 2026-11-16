'use client'

// Bascule clair/nuit (charte Amerys : nuit par défaut). Le thème est porté par
// <html data-theme>, posé avant le premier rendu par le script de
// app/layout.tsx à partir de localStorage('ads-theme') — ce composant ne fait
// que lire cet attribut et l'inverser. useSyncExternalStore : rendu serveur
// "nuit", valeur réelle côté client sans setState dans un effet ni écart
// d'hydratation.
import { useSyncExternalStore } from 'react'
import { onDark, onDarkFill, onDarkLine, radiusButton } from './format'

type Theme = 'dark' | 'light'
const STORAGE_KEY = 'ads-theme'

function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Stockage indisponible (navigation privée stricte) : thème appliqué pour
    // la session en cours seulement.
  }
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'dark' as Theme)
  const isLight = theme === 'light'
  const label = isLight ? 'Activer le mode nuit' : 'Activer le mode clair'

  return (
    <button
      type="button"
      onClick={() => applyTheme(isLight ? 'dark' : 'light')}
      // Libellé fixe + aria-pressed : l'état (activé ou non) porte
      // l'information, le libellé ne change pas.
      aria-label="Mode clair"
      aria-pressed={isLight}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        borderRadius: radiusButton,
        border: `1px solid ${onDarkLine}`,
        background: onDarkFill,
        color: onDark,
        padding: 0,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {isLight ? (
        // Lune : passer en nuit
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
        </svg>
      ) : (
        // Soleil : passer en clair
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </svg>
      )}
    </button>
  )
}
