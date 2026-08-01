'use client'

import { useState } from 'react'
import { campaignDurationDays } from '@/lib/calculations'
import { accent, green, ink, line, red, surface } from './format'

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
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        type="date"
        value={endDate}
        min={startDate ?? undefined}
        onChange={(e) => setEndDate(e.target.value)}
        disabled={isSaving}
        style={{
          fontSize: 12.5,
          fontFamily: 'inherit',
          color: ink,
          background: surface,
          border: `1px solid ${line}`,
          borderRadius: 8,
          padding: '5px 8px',
        }}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#FFFFFF',
          background: accent,
          border: 0,
          borderRadius: 8,
          padding: '6px 12px',
          cursor: isSaving ? 'default' : 'pointer',
          opacity: isSaving ? 0.65 : 1,
        }}
      >
        {isSaving ? 'Enregistrement…' : 'Enregistrer'}
      </button>
      {state.status === 'success' ? (
        <span style={{ fontSize: 12, color: green }}>
          Enregistré{duration !== null ? ` · Durée : ${duration} j` : ''}
        </span>
      ) : null}
      {state.status === 'error' ? <span style={{ fontSize: 12, color: red }}>{state.message}</span> : null}
    </div>
  )
}
