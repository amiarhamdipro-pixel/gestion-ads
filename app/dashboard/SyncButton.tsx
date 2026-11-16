'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  accent,
  amber,
  gray,
  green,
  headerButton,
  headerButtonText,
  ink,
  line,
  muted,
  radius,
  radiusButton,
  red,
  shadow,
  softBg,
  surfaceElevated,
} from './format'
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

type Outcome = 'success' | 'partial' | 'failed' | 'none'

const OUTCOME_LABEL: Record<Outcome, string> = {
  success: 'Réussite',
  partial: 'Réussite partielle',
  failed: 'Échec',
  none: 'Aucune campagne à synchroniser',
}

const OUTCOME_COLOR: Record<Outcome, string> = { success: green, partial: amber, failed: red, none: gray }

// Même correspondance que l'historique (route.ts, runStatus) : jamais un
// succès global si un volet a échoué (report.ok, calculé côté serveur).
function outcomeOf(report: SyncAllReport): Outcome {
  if (report.noCampaignToSync) return 'none'
  if (report.abortedAtStep) return 'failed'
  return report.ok ? 'success' : 'partial'
}

// Volets en échec d'une réussite partielle, dérivés uniquement des champs du
// rapport (aucune cause inventée : le détail reste dans l'historique).
function partialIssues(report: SyncAllReport): string[] {
  const issues: string[] = []
  const t = report.metaTotals
  if (t && t.failed > 0 && t.targetCampaignNumber !== null) issues.push(`campagne n°${t.targetCampaignNumber} en échec`)
  if (report.metaDaily && ('error' in report.metaDaily || report.metaDaily.failed > 0)) issues.push('quotidien Meta en échec')
  const a = report.calendlyAppointments
  const appointmentErrors = a ? a.errors - a.ambiguous : 0
  // « rendez-vous » est invariable : pas de plural().
  if (appointmentErrors > 0) issues.push(`${appointmentErrors} rendez-vous Calendly en erreur`)
  if (report.calendlyDaily && 'error' in report.calendlyDaily) issues.push('quotidien Calendly en échec')
  return issues
}

function Badge({ label, color }: { label: string; color: string }) {
  // Texte ink sur fond softBg (même principe que les autres badges du
  // dashboard) : red/green sur leur propre fond pâle manquent de contraste.
  return (
    <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: ink, background: softBg(color, 0.16) }}>
      {label}
    </span>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ color: muted }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

// Rapport final compact : résultat, compteurs réellement présents dans
// SyncAllReport (un volet non lancé s'affiche « — », jamais 0 inventé) et
// lien vers l'historique détaillé (/dashboard/synchronisations).
//
// Règle métier officielle (voir BRIEF-CLAUDE-CODE.md) : une seule campagne
// dynamique traitée par appel — le rapport la nomme explicitement.
function ReportCard({ outcome, report, message, onClose }: { outcome: Outcome; report: SyncAllReport | null; message: string | null; onClose: () => void }) {
  const t = report?.metaTotals ?? null
  const a = report?.calendlyAppointments ?? null
  const issues = report && outcome === 'partial' ? partialIssues(report) : []

  return (
    <div
      role={outcome === 'failed' ? 'alert' : 'status'}
      className="amerys-sync-report"
      style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        marginTop: 8,
        width: 300,
        background: surfaceElevated,
        color: ink,
        border: `1px solid ${line}`,
        borderRadius: radius,
        boxShadow: shadow,
        padding: 14,
        fontSize: 12.5,
        zIndex: 5,
      }}
    >
      <style>{`
        @media (max-width: 640px) {
          .amerys-sync-report { position: static !important; width: auto !important; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <Badge label={OUTCOME_LABEL[outcome]} color={OUTCOME_COLOR[outcome]} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le rapport"
          style={{ border: 0, background: 'transparent', color: muted, cursor: 'pointer', padding: 8, margin: -4, lineHeight: 0, borderRadius: radiusButton }}
        >
          <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {report && outcome === 'none' ? (
        <p style={{ color: muted }}>
          {t && t.skippedLocked.length > 0
            ? `${plural(t.skippedLocked.length, 'campagne')} déjà validée${t.skippedLocked.length > 1 ? 's' : ''} (${listNumbers(t.skippedLocked)}).`
            : 'Aucune campagne dynamique candidate.'}
        </p>
      ) : null}

      {report && outcome !== 'none' ? (
        <div>
          <Row
            label="Campagne synchronisée"
            value={t && t.targetCampaignNumber !== null ? (t.succeeded > 0 ? `n°${t.targetCampaignNumber}` : `aucune (n°${t.targetCampaignNumber} en échec)`) : '—'}
          />
          <Row label="RDV Calendly retenus" value={a ? a.retained : '—'} />
          <Row label="Erreurs" value={report.totalErrors} />
          {a && a.ambiguous > 0 ? <Row label="RDV ambigus (non rattachés)" value={a.ambiguous} /> : null}
          {t && t.waiting.length > 0 ? <Row label="En attente" value={listNumbers(t.waiting)} /> : null}
        </div>
      ) : null}

      {message || issues.length > 0 ? (
        <p style={{ marginTop: 8, padding: '8px 10px', borderRadius: radiusButton, background: softBg(outcome === 'failed' ? red : amber, 0.1) }}>
          {message ?? `À vérifier : ${issues.join(', ')}.`}
        </p>
      ) : null}

      <Link href="/dashboard/synchronisations" style={{ display: 'inline-block', marginTop: 10, color: accent, fontWeight: 650, textDecoration: 'none' }}>
        Voir l’historique →
      </Link>
    </div>
  )
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
          // Bouton principal du header de la charte : fond clair, texte
          // aubergine, rayon 9 px, 13 px / graisse 650, hauteur 44 px.
          border: 0,
          borderRadius: radiusButton,
          minHeight: 44,
          padding: '0 20px',
          fontSize: 13,
          fontWeight: 650,
          cursor: isSyncing ? 'default' : 'pointer',
          background: headerButton,
          color: headerButtonText,
          opacity: isSyncing ? 0.7 : 1,
        }}
      >
        <SyncIcon size={16} />
        {state.status === 'loading' ? STAGE_LABEL[state.stage] : 'Synchroniser'}
      </button>
      {state.status === 'success' ? (
        <ReportCard
          outcome={outcomeOf(state.report)}
          report={state.report}
          message={state.report.abortedAtStep ? state.report.abortMessage : null}
          onClose={() => setState({ status: 'idle' })}
        />
      ) : null}
      {state.status === 'error' ? (
        <ReportCard outcome="failed" report={null} message={state.message} onClose={() => setState({ status: 'idle' })} />
      ) : null}
    </div>
  )
}
