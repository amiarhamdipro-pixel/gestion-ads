'use client'

// Navigation latérale persistante. Reflète uniquement les fonctionnalités
// réellement disponibles : Vue d'ensemble et Comparaison pour tous, plus
// Utilisateurs pour les admins uniquement. Aucune entrée décorative vers des
// pages qui n'existent pas (Vidéos, Synchronisations, Clients, Paramètres...).

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { logout } from './actions'
import { accent, getMobileMenuOpen, ink, line, muted, setMobileMenuOpen, subscribeMobileMenu, surface } from './format'
import { ChevronDownIcon, CompareIcon, HomeIcon, LogoutIcon, UserIcon } from './icons'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export default function Sidebar({
  userName,
  userEmail,
  isAdmin,
}: {
  userName: string
  userEmail: string
  isAdmin: boolean
}) {
  const pathname = usePathname()
  // Préserve le filtre de période actif (DashboardDateFilter) en naviguant
  // entre les pages : la query string est l'état partagé, aucune duplication.
  const query = useSearchParams().toString()

  const menuOpen = useSyncExternalStore(subscribeMobileMenu, getMobileMenuOpen, () => false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const nav = [
    { label: "Vue d'ensemble", href: '/dashboard', icon: HomeIcon },
    { label: 'Comparaison', href: '/dashboard/comparison', icon: CompareIcon },
    ...(isAdmin ? [{ label: 'Utilisateurs', href: '/dashboard/admin/users', icon: UserIcon }] : []),
  ]

  function closeMenu() {
    setMobileMenuOpen(false)
  }

  // Ouverture plus naturelle : le focus clavier suit le tiroir (sur le
  // bouton fermer) au lieu de rester sur le hamburger désormais recouvert —
  // sans ça, Tab depuis un lecteur d'écran/clavier continue de parcourir le
  // contenu de la page sous le tiroir, invisible mais toujours dans le flux.
  // Verrouille aussi le défilement de la page derrière le tiroir (comme tout
  // tiroir mobile natif) — sans ça, la page défile "à travers" un tiroir
  // censé être modal.
  useEffect(() => {
    if (!menuOpen) return
    closeButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [menuOpen])

  return (
    <>
    <div
      className={menuOpen ? 'amerys-backdrop amerys-backdrop--visible' : 'amerys-backdrop'}
      aria-hidden="true"
      onClick={closeMenu}
    />
    <aside
      id="amerys-sidebar-nav"
      className={menuOpen ? 'amerys-sidebar amerys-sidebar--open' : 'amerys-sidebar'}
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
        // .amerys-sidebar (layout.tsx), seule à varier selon le breakpoint
        // (desktop vs tiroir mobile) — un style inline ne pourrait jamais
        // être surchargé par une media query.
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={closeMenu}
        className="amerys-sidebar-close"
        aria-label="Fermer le menu"
        style={{
          alignSelf: 'flex-end',
          alignItems: 'center',
          justifyContent: 'center',
          // 40px : proche du seuil de 44px recommandé pour une cible tactile
          // (bouton dédié fermeture, ouvert uniquement sur mobile/tablette).
          width: 40,
          height: 40,
          borderRadius: 10,
          border: `1px solid ${line}`,
          background: 'transparent',
          padding: 0,
          font: 'inherit',
          color: muted,
          cursor: 'pointer',
          marginBottom: 12,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      </button>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {nav.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={query ? `${item.href}?${query}` : item.href}
              onClick={closeMenu}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                // Cible tactile ≈44px (13px de padding vertical + texte/icône) :
                // plus confortable au doigt qu'au pointeur souris, sans rien
                // changer visuellement au-delà de la hauteur de la ligne.
                padding: '13px 12px',
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
    </>
  )
}
