'use client'

// Navigation latérale persistante. Reflète uniquement les fonctionnalités
// réellement disponibles : Vue d'ensemble et Comparaison. Aucune entrée
// décorative vers des pages qui n'existent pas (Vidéos, Synchronisations,
// Clients, Utilisateurs, Paramètres, Administration...).

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { logout } from './actions'
import { accent, ink, line, muted, surface } from './format'
import { ChevronDownIcon, CompareIcon, HomeIcon, LogoutIcon } from './icons'

const nav = [
  { label: "Vue d'ensemble", href: '/dashboard', icon: HomeIcon },
  { label: 'Comparaison', href: '/dashboard/comparison', icon: CompareIcon },
]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export default function Sidebar({ userName, userEmail }: { userName: string; userEmail: string }) {
  const pathname = usePathname()
  // Préserve le filtre de période actif (DashboardDateFilter) en naviguant
  // entre les pages : la query string est l'état partagé, aucune duplication.
  const query = useSearchParams().toString()

  return (
    <aside
      className="amerys-sidebar"
      style={{
        width: 220,
        flexShrink: 0,
        background: surface,
        borderRight: `1px solid ${line}`,
        minHeight: 'calc(100vh - 73px)',
        display: 'flex',
        flexDirection: 'column',
        paddingLeft: 14,
        paddingRight: 14,
        paddingBottom: 22,
        // paddingTop volontairement absent d'ici : piloté par la classe
        // .amerys-sidebar (layout.tsx) pour pouvoir varier selon la hauteur
        // réelle du header (une ligne sur tablette, plusieurs sur mobile) —
        // un style inline ne pourrait jamais être surchargé par une media query.
      }}
    >
      <label
        htmlFor="amerys-menu"
        className="amerys-sidebar-close"
        aria-label="Fermer le menu"
        style={{
          alignSelf: 'flex-end',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 8,
          border: `1px solid ${line}`,
          color: muted,
          cursor: 'pointer',
          marginBottom: 12,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      </label>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {nav.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={query ? `${item.href}?${query}` : item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: 13.5,
                fontWeight: active ? 600 : 500,
                textDecoration: 'none',
                background: active ? accent : 'transparent',
                color: active ? '#FFFFFF' : ink,
              }}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${line}` }}>
        <details>
          <summary
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 10,
              cursor: 'pointer',
              listStyle: 'none',
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: accent,
                color: '#FFFFFF',
                fontSize: 12.5,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              {initials(userName)}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {userName}
              </span>
              <span style={{ display: 'block', fontSize: 11, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {userEmail}
              </span>
            </span>
            <ChevronDownIcon size={15} />
          </summary>
          <form action={logout} style={{ marginTop: 6 }}>
            <button
              type="submit"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                border: 0,
                background: 'transparent',
                color: muted,
                fontSize: 13,
                fontWeight: 500,
                padding: '8px 10px',
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              <LogoutIcon size={16} />
              Se déconnecter
            </button>
          </form>
        </details>
      </div>
    </aside>
  )
}
