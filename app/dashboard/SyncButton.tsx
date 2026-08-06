'use client'

import { useState } from 'react'
import { accent, onDark, onDarkMuted, redOnDark } from './format'
import { SyncIcon } from './icons'
import type { SyncAllReport } from '../api/admin/sync/all/route'

type Stage = 'meta' | 'calendly' | 'finalizing'

const STAGE_LABEL: Record<Stage, string> = {
  meta: 'Synchronisation Meta…',
  calendly: 'Synchronisation Calendly…',
  finalizing: 'Finalisation…',
}

type SyncState =
  | { status: 'idle' }
  | { status: 'loading'; stage: Stage }
  | { status: 'success'; report: SyncAllReport }
  | { status: 'error'; message: string }

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`
}

function listNumbers(numbers: number[]): string {
  return numbers.map((n) => `n°${n}`).join(', ')
}

// Rapport final court : une ligne par volet, jamais un succès global si un
// volet a échoué (report.ok reflète ça, calculé côté serveur — voir
// route.ts). Les champs à null (étape jamais atteinte, échec dur en amont
// OU aucune campagne à traiter) sont explicitement signalés, jamais
// silencieusement omis.
//
// Règle métier officielle (voir BRIEF-CLAUDE-CODE.md) : une seule campagne
// dynamique traitée par appel — le rapport nomme toujours explicitement
// laquelle ("Campagne 20 synchronisée"), jamais un simple compte pluralisé
// comme avant (qui n'aurait plus de sens à 0 ou 1 campagne).
function summarizeReport(report: SyncAllReport): string[] {
  const lines: string[] = []

  if (report.abortedAtStep) {
    lines.push(`❌ ${report.abortMessage}`)
  }

  if (report.noCampaignToSync) {
    lines.push('Aucune campagne à synchroniser.')
    if (report.metaTotals && report.metaTotals.skippedLocked.length > 0) {
      lines.push(
        `${plural(report.metaTotals.skippedLocked.length, 'campagne')} déjà validée${report.metaTotals.skippedLocked.length > 1 ? 's' : ''} (${listNumbers(report.metaTotals.skippedLocked)})`
      )
    }
    return lines
  }

  if (report.metaTotals) {
    const t = report.metaTotals
    if (t.targetCampaignNumber !== null) {
      lines.push(
        (t.succeeded > 0 ? `Campagne ${t.targetCampaignNumber} synchronisée` : `❌ Échec de la campagne ${t.targetCampaignNumber}`) +
          (report.metaDaily
            ? 'error' in report.metaDaily
              ? ' · quotidien : échec'
              : ` · ${plural(report.metaDaily.daysUpserted, 'jour')} mis à jour`
            : '')
      )
    }
    if (t.skippedLocked.length > 0) {
      lines.push(`${plural(t.skippedLocked.length, 'campagne verrouillée')} ignorée${t.skippedLocked.length > 1 ? 's' : ''} (${listNumbers(t.skippedLocked)})`)
    }
    if (t.waiting.length > 0) {
      lines.push(`${plural(t.waiting.length, 'campagne')} en attente (${listNumbers(t.waiting)})`)
    }
  }

  if (report.calendlyAppointments) {
    const c = report.calendlyAppointments
    lines.push(
      `Calendly : ${plural(c.read, 'rendez-vous')} lu${c.read > 1 ? 's' : ''} · ${plural(c.retained, 'retenu')} (Meta)` +
        (report.calendlyDaily
          ? 'error' in report.calendlyDaily
            ? ' · quotidien : échec'
            : ` · ${plural(report.calendlyDaily.daysWritten, 'jour')} recalculé${report.calendlyDaily.daysWritten > 1 ? 's' : ''}`
          : '')
    )
    if (c.ambiguous > 0) {
      lines.push(`${plural(c.ambiguous, 'rendez-vous ambigu')} — chevauchement de campagnes, non rattaché${c.ambiguous > 1 ? 's' : ''}`)
    }
  }

  if (report.totalErrors > 0) {
    lines.push(`⚠ ${plural(report.totalErrors, 'erreur')} au total`)
  } else if (!report.abortedAtStep) {
    lines.push('✅ Synchronisation complète, aucune erreur')
  }

  return lines
}

export default function SyncButton() {
  const [state, setState] = useState<SyncState>({ status: 'idle' })

  const isSyncing = state.status === 'loading'

  async function handleSync() {
    if (isSyncing) return
    setState({ status: 'loading', stage: 'meta' })

    try {
      const response = await fetch('/api/admin/sync/all', { method: 'POST' })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setState({ status: 'error', message: body?.error ?? 'Échec de la synchronisation.' })
        return
      }

      if (!response.body) {
        setState({ status: 'error', message: 'Échec de la synchronisation (réponse vide).' })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let report: SyncAllReport | null = null

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')
          if (!line.trim()) continue

          const event = JSON.parse(line) as { type: 'stage'; stage: Stage } | { type: 'result'; report: SyncAllReport }
          if (event.type === 'stage') {
            setState({ status: 'loading', stage: event.stage })
          } else {
            report = event.report
          }
        }
      }

      if (report) {
        setState({ status: 'success', report })
      } else {
        setState({ status: 'error', message: 'Échec de la synchronisation (réponse incomplète).' })
      }
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
        {state.status === 'loading' ? STAGE_LABEL[state.stage] : 'Synchroniser'}
      </button>
      {state.status === 'success' ? (
        <p
          role="status"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 8,
            fontSize: 11.5,
            color: state.report.ok ? onDarkMuted : redOnDark,
            whiteSpace: 'nowrap',
            textAlign: 'right',
          }}
        >
          {summarizeReport(state.report).map((line, i) => (
            <span key={i}>
              {i > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p
          role="alert"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 8,
            fontSize: 11.5,
            color: redOnDark,
            whiteSpace: 'nowrap',
          }}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
