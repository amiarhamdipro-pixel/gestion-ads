'use client'

// Filtre de période global, unique référence pour toutes les pages du
// dashboard. L'état partagé est la query string de l'URL (?period=...&
// from=...&to=...) : chaque page (Server Component) la lit via son propre
// prop `searchParams` et interroge campaign_daily_stats directement sur
// stat_date — aucune requête réseau supplémentaire côté client, aucun état
// dupliqué. Panneau construit avec <details>/<summary>, même motif déjà
// utilisé par le menu profil de Sidebar.tsx (aucune dépendance ajoutée).

import { useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { isDateRangePreset, type DateRangePreset } from '@/lib/calculations'
import { accent, faint, formatPeriod, ink, line, muted, onDark, radius, surface } from './format'
import { CalendarIcon, ChevronDownIcon } from './icons'

const OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: "Aujourd'hui" },
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: 'month', label: 'Ce mois' },
  { value: 'custom', label: 'Personnalisé' },
]

export default function DashboardDateFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const detailsRef = useRef<HTMLDetailsElement>(null)

  const periodParam = searchParams.get('period')
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const activePreset = isDateRangePreset(periodParam) ? periodParam : null

  const [pendingCustom, setPendingCustom] = useState(false)
  const [customStart, setCustomStart] = useState(fromParam ?? '')
  const [customEnd, setCustomEnd] = useState(toParam ?? '')

  // Resynchronise les champs personnalisés si l'URL change en dehors de ce
  // composant (navigation arrière/avant du navigateur) — ajustement pendant
  // le rendu (pattern documenté React), pas un effet, pour éviter un rendu
  // en cascade inutile.
  const [trackedFromParam, setTrackedFromParam] = useState(fromParam)
  const [trackedToParam, setTrackedToParam] = useState(toParam)
  if (fromParam !== trackedFromParam || toParam !== trackedToParam) {
    setTrackedFromParam(fromParam)
    setTrackedToParam(toParam)
    setCustomStart(fromParam ?? '')
    setCustomEnd(toParam ?? '')
  }

  const showCustomFields = pendingCustom || activePreset === 'custom'

  const activeLabel = !activePreset
    ? 'Toutes les périodes'
    : activePreset === 'custom' && fromParam && toParam
      ? formatPeriod(fromParam, toParam)
      : (OPTIONS.find((o) => o.value === activePreset)?.label ?? 'Toutes les périodes')

  function close() {
    detailsRef.current?.removeAttribute('open')
  }

  function applyPreset(preset: DateRangePreset) {
    if (preset === 'custom') {
      setPendingCustom(true)
      return
    }
    setPendingCustom(false)
    router.replace(`${pathname}?period=${preset}`)
    close()
  }

  function applyCustom() {
    if (!customStart || !customEnd) return
    router.replace(`${pathname}?period=custom&from=${customStart}&to=${customEnd}`)
    setPendingCustom(false)
    close()
  }

  function reset() {
    setPendingCustom(false)
    router.replace(pathname)
    close()
  }

  return (
    <details ref={detailsRef} style={{ position: 'relative' }}>
      <summary
        style={{
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          background: 'rgba(255, 255, 255, 0.08)',
          borderRadius: 999,
          padding: '7px 14px',
          fontSize: 12.5,
          fontWeight: 600,
          color: onDark,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
        }}
      >
        <CalendarIcon size={14} />
        {activeLabel}
        <ChevronDownIcon size={13} style={{ opacity: 0.6 }} />
      </summary>

      <div
        style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          zIndex: 10,
          width: 250,
          background: surface,
          border: `1px solid ${line}`,
          borderRadius: radius,
          padding: 10,
          boxShadow: '0 16px 32px rgba(15, 16, 30, 0.2)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {OPTIONS.map((opt) => {
            const active = opt.value === 'custom' ? showCustomFields : activePreset === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => applyPreset(opt.value)}
                style={{
                  textAlign: 'left',
                  border: 0,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? accent : ink,
                  background: active ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {showCustomFields ? (
          <div style={{ marginTop: 8, paddingTop: 10, borderTop: `1px solid ${line}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: muted }}>
              Début
              <input
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{ fontSize: 12.5, fontFamily: 'inherit', color: ink, background: surface, border: `1px solid ${line}`, borderRadius: 8, padding: '6px 8px' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: muted }}>
              Fin
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{ fontSize: 12.5, fontFamily: 'inherit', color: ink, background: surface, border: `1px solid ${line}`, borderRadius: 8, padding: '6px 8px' }}
              />
            </label>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!customStart || !customEnd}
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: '#FFFFFF',
                background: accent,
                border: 0,
                borderRadius: 8,
                padding: '7px 10px',
                cursor: !customStart || !customEnd ? 'default' : 'pointer',
                opacity: !customStart || !customEnd ? 0.55 : 1,
              }}
            >
              Appliquer
            </button>
          </div>
        ) : null}

        {activePreset ? (
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${line}`,
              width: '100%',
              textAlign: 'left',
              border: 0,
              background: 'transparent',
              fontSize: 12,
              color: faint,
              cursor: 'pointer',
            }}
          >
            Réinitialiser (toutes les périodes)
          </button>
        ) : null}
      </div>
    </details>
  )
}
