'use client'

import { useState } from 'react'

type SyncState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

export default function SyncMetaButton() {
  const [campaignNumber, setCampaignNumber] = useState(20)
  const [state, setState] = useState<SyncState>({ status: 'idle' })

  const isSyncing = state.status === 'loading'

  async function handleSync() {
    if (isSyncing) return
    setState({ status: 'loading' })

    try {
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignNumber }),
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setState({ status: 'error', message: body?.error ?? 'Échec de la synchronisation.' })
        return
      }

      setState({
        status: 'success',
        message:
          `Campagne "${body.campaign.name}" synchronisée : ` +
          `${body.counts.audiences} audience(s), ${body.counts.videos} vidéo(s).`,
      })
    } catch {
      setState({ status: 'error', message: 'Échec de la synchronisation.' })
    }
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <label>
        Numéro de campagne
        <input
          type="number"
          value={campaignNumber}
          onChange={(e) => setCampaignNumber(Number(e.target.value))}
          disabled={isSyncing}
          style={{ marginLeft: '0.5rem', width: '5rem' }}
        />
      </label>
      <button type="button" onClick={handleSync} disabled={isSyncing} style={{ marginLeft: '0.5rem' }}>
        {isSyncing ? 'Synchronisation...' : 'Synchroniser Meta'}
      </button>
      {state.status === 'success' ? <p style={{ color: 'green' }}>{state.message}</p> : null}
      {state.status === 'error' ? <p style={{ color: 'crimson' }}>{state.message}</p> : null}
    </div>
  )
}
