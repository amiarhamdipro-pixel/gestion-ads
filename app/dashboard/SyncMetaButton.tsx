'use client'

import { useState } from 'react'

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
    <div style={{ marginTop: '1.5rem' }}>
      <button type="button" onClick={handleSync} disabled={isSyncing}>
        {isSyncing ? 'Synchronisation en cours...' : 'Synchroniser toutes les campagnes'}
      </button>
      {state.status === 'success' ? (
        <p>
          Campagnes traitées : {state.report.totalDetected} · Succès : {state.report.succeeded} · Échecs :{' '}
          {state.report.failed} · Groupes invalides : {state.report.invalid.length}
        </p>
      ) : null}
      {state.status === 'error' ? <p style={{ color: 'crimson' }}>{state.message}</p> : null}
    </div>
  )
}
