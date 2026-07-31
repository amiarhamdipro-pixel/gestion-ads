'use client'

import { useState } from 'react'
import { campaignDurationDays } from '@/lib/calculations'

type Props = {
  campaignId: string
  startDate: string | null
  initialEndDate: string | null
}

type SaveState = { status: 'idle' | 'saving' } | { status: 'success'; endDate: string } | { status: 'error'; message: string }

export default function EndDateEditor({ campaignId, startDate, initialEndDate }: Props) {
  const [endDate, setEndDate] = useState(initialEndDate ?? '')
  const [savedEndDate, setSavedEndDate] = useState(initialEndDate)
  const [state, setState] = useState<SaveState>({ status: 'idle' })

  const isSaving = state.status === 'saving'
  const duration = campaignDurationDays(startDate, savedEndDate)

  async function handleSave() {
    if (isSaving) return
    if (!endDate) {
      setState({ status: 'error', message: 'Choisissez une date.' })
      return
    }
    setState({ status: 'saving' })

    try {
      const response = await fetch('/api/admin/campaigns/end-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, endDate }),
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setState({ status: 'error', message: body?.error ?? "Échec de l'enregistrement." })
        return
      }

      setSavedEndDate(body.campaign.end_date)
      setState({ status: 'success', endDate: body.campaign.end_date })
    } catch {
      setState({ status: 'error', message: "Échec de l'enregistrement." })
    }
  }

  return (
    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        type="date"
        value={endDate}
        min={startDate ?? undefined}
        onChange={(e) => setEndDate(e.target.value)}
        disabled={isSaving}
        style={{ fontSize: 12 }}
      />
      <button type="button" onClick={handleSave} disabled={isSaving} style={{ fontSize: 12 }}>
        {isSaving ? 'Enregistrement...' : 'Enregistrer la fin'}
      </button>
      {state.status === 'success' ? (
        <span style={{ fontSize: 12, color: 'green' }}>
          Enregistré{duration !== null ? ` · Durée : ${duration} j` : ''}
        </span>
      ) : null}
      {state.status === 'error' ? <span style={{ fontSize: 12, color: 'crimson' }}>{state.message}</span> : null}
    </div>
  )
}
