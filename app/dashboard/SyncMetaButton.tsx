'use client'

import { useState } from 'react'
import { accent, onDark, onDarkMuted } from './format'
import { SyncIcon } from './icons'

type TotalsReport = {
  totalDetected: number
  succeeded: number
  failed: number
  invalid: { campaignNumber: number; reason: string }[]
}

type DailyReport =
  | {
      totalDetected: number
      succeeded: number
      failed: number
      stoppedOnRateLimit: boolean
      daysUpserted: number
      invalid: { campaignNumber: number; reason: string }[]
    }
  | { error: string }

type SyncReport = { totals: TotalsReport; daily: DailyReport }

type SyncState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; report: SyncReport }
  | { status: 'error'; message: string }

function summarizeTotals(totals: TotalsReport): string {
  return (
    `Totaux : ${totals.succeeded} campagne${totals.succeeded > 1 ? 's' : ''} synchronisée${totals.succeeded > 1 ? 's' : ''}` +
    (totals.failed > 0 ? ` · ${totals.failed} échec${totals.failed > 1 ? 's' : ''}` : '')
  )
}

function summarizeDaily(daily: DailyReport): string {
  if ('error' in daily) return 'Quotidien : échec'
  return (
    `Quotidien : ${daily.daysUpserted} jour${daily.daysUpserted > 1 ? 's' : ''} mis à jour` +
    (daily.failed > 0 ? ` · ${daily.failed} échec${daily.failed > 1 ? 's' : ''}` : '') +
    (daily.stoppedOnRateLimit ? ' · limite Meta atteinte' : '')
  )
}

export default function SyncMetaButton() {
  const [state, setState] = useState<SyncState>({ status: 'idle' })

  const isSyncing = state.status === 'loading'

  async function handleSync() {
    if (isSyncing) return
    setState({ status: 'loading' })

    try {
      const response = await fetch('/api/admin/sync', { method: 'POST' })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setState({ status: 'error', message: body?.error ?? 'Échec de la synchronisation.' })
        return
      }

      setState({ status: 'success', report: body })
    } catch {
      setState({ status: 'error', message: 'Échec de la synchronisation.' })
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={handleSync}
        disabled={isSyncing}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: 0,
          borderRadius: 999,
          padding: '11px 22px',
          fontSize: 13.5,
          fontWeight: 700,
          cursor: isSyncing ? 'default' : 'pointer',
          background: accent,
          color: onDark,
          opacity: isSyncing ? 0.7 : 1,
          boxShadow: '0 4px 14px rgba(79, 70, 229, 0.45)',
        }}
      >
        <SyncIcon size={16} />
        {isSyncing ? 'Synchronisation…' : 'Synchroniser'}
      </button>
      {state.status === 'success' ? (
        <p
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 8,
            fontSize: 11.5,
            color: onDarkMuted,
            whiteSpace: 'nowrap',
            textAlign: 'right',
          }}
        >
          {summarizeTotals(state.report.totals)}
          <br />
          {summarizeDaily(state.report.daily)}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 8,
            fontSize: 11.5,
            color: '#FF9B9B',
            whiteSpace: 'nowrap',
          }}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
