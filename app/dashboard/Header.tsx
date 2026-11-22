'use client'

// Header applicatif persistant (chrome de l'app, pleine largeur — MAQUETTE-UI.png).
// Purement présentationnel : toutes les données sont chargées par
// app/dashboard/layout.tsx, aucune requête ici. 'use client' uniquement pour
// piloter le bouton hamburger (état ouvert/fermé exposé via aria-expanded,
// source unique partagée avec Sidebar.tsx — voir subscribeMobileMenu dans
// format.ts).
import { Suspense, useEffect, useSyncExternalStore } from 'react'
import Image from 'next/image'
import { BRAND_ICON_ALT, BRAND_ICON_SRC, BRAND_NAME, BRAND_SUBTITLE } from '../brand'
import {
  formatDateTime,
  getMobileMenuOpen,
  headerBg,
  onDark,
  onDarkFill,
  onDarkLine,
  onDarkMuted,
  radiusButton,
  setMobileMenuOpen,
  subscribeMobileMenu,
} from './format'
import { ClockIcon, CrownIcon, UserIcon } from './icons'
import SyncButton from './SyncButton'
import DashboardDateFilter from './DashboardDateFilter'
import ThemeToggle from './ThemeToggle'

const roleLabel: Record<string, string> = {
  admin: 'Admin',
  client: 'Client',
}

const pillStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  background: onDarkFill,
  border: `1px solid ${onDarkLine}`,
  borderRadius: 999,
  padding: '7px 14px',
  fontSize: 12.5,
  fontWeight: 600,
  color: onDark,
  whiteSpace: 'nowrap',
}

export default function Header({
  clientName,
  role,
  isAdmin,
  lastSyncAt,
  lastCalendlyModifiedAt,
}: {
  clientName: string | null
  role: string | null
  isAdmin: boolean
  lastSyncAt: string | null
  lastCalendlyModifiedAt: string | null
}) {
  const menuOpen = useSyncExternalStore(subscribeMobileMenu, getMobileMenuOpen, () => false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function toggleMenu() {
    setMobileMenuOpen(!menuOpen)
  }

  return (
    <header style={{ background: headerBg, borderBottom: `1px solid ${onDarkLine}`, position: 'relative', zIndex: 60 }}>
      <div
        style={{
          padding: '13px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={toggleMenu}
            className="amerys-menu-label"
            aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={menuOpen}
            aria-controls="amerys-sidebar-nav"
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: radiusButton,
              background: onDarkFill,
              border: `1px solid ${onDarkLine}`,
              color: onDark,
              padding: 0,
              font: 'inherit',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
              <path d="M1 1h16M1 7h16M1 13h16" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>

          {/* Symbole officiel Amerys (kit 2026) : badge circulaire autonome,
              même emprise que l'ancien bloc logo (46 px). */}
          <Image
            src={BRAND_ICON_SRC}
            alt={BRAND_ICON_ALT}
            width={46}
            height={46}
            loading="eager"
            style={{ display: 'block', width: 46, height: 46, borderRadius: '50%', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 650, fontSize: 16, color: onDark, letterSpacing: '.02em', lineHeight: 1.15 }}>
              {BRAND_NAME}
            </div>
            <div style={{ fontSize: 11.5, color: onDarkMuted, marginTop: 1 }}>{BRAND_SUBTITLE}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={pillStyle}>{clientName ?? 'Aucun client'}</div>

          <div style={pillStyle}>
            {isAdmin ? <CrownIcon size={14} /> : <UserIcon size={14} />}
            {role ? (roleLabel[role] ?? role) : '—'}
          </div>

          {isAdmin ? (
            <Suspense fallback={null}>
              <DashboardDateFilter />
            </Suspense>
          ) : null}

          {isAdmin ? <SyncButton /> : null}

          <ThemeToggle />

          {isAdmin ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <ClockIcon size={16} style={{ color: onDarkMuted, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 10, color: onDarkMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    Dernière synchro Meta
                  </div>
                  <div style={{ fontSize: 12.5, color: onDark, fontWeight: 500, marginTop: 1 }}>
                    {formatDateTime(lastSyncAt)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <ClockIcon size={16} style={{ color: onDarkMuted, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 10, color: onDarkMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    Dernière modification Calendly
                  </div>
                  <div style={{ fontSize: 12.5, color: onDark, fontWeight: 500, marginTop: 1 }}>
                    {formatDateTime(lastCalendlyModifiedAt)}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}
