'use client'

import { useState } from 'react'
import { accent, onDark, onDarkMuted } from './format'
import { SyncIcon } from './icons'

type SyncReport = {
  totalDetected: number
  succeeded: number
  failed: number
  invalid: { campaignNumber: number; reason: string }[]
}

type SyncState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; report: SyncReport }
  | { status: 'error'; message: string }

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
          }}
        >
          {state.report.succeeded} campagne{state.report.succeeded > 1 ? 's' : ''} synchronisée
          {state.report.succeeded > 1 ? 's' : ''}
          {state.report.failed > 0 ? ` · ${state.report.failed} échec${state.report.failed > 1 ? 's' : ''}` : ''}
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
