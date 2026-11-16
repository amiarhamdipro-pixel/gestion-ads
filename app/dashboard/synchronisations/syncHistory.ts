// Lecture et présentation de l'historique admin_sync_runs (page
// /dashboard/synchronisations). Le rapport JSONB est relu en liste blanche :
// seuls les champs connus, correctement typés, sont extraits — jamais le JSON
// brut affiché, jamais une chaîne libre issue de la base (les libellés
// affichés viennent tous des tables ci-dessous ; une valeur inconnue devient
// « inconnue », jamais recopiée telle quelle).

import type { AdminSyncRunStatus, Json } from '@/types/database'

export const PAGE_SIZE = 20

// Au-delà, une exécution encore `running` est présentée comme
// « Potentiellement interrompue » (statut en base inchangé).
export const STALE_RUNNING_MS = 15 * 60 * 1000

export type DisplayStatus = AdminSyncRunStatus | 'interrupted'

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  success: 'Réussie',
  partial: 'Partiellement réussie',
  failed: 'Échouée',
  no_campaign: 'Aucune campagne à synchroniser',
  running: 'En cours',
  interrupted: 'Potentiellement interrompue',
}

export const STATUS_FILTER_VALUES: DisplayStatus[] = ['success', 'partial', 'failed', 'no_campaign', 'running', 'interrupted']

export function isDisplayStatus(value: string): value is DisplayStatus {
  return (STATUS_FILTER_VALUES as string[]).includes(value)
}

// Instant de référence de la requête (Server Component, rendu une fois par
// requête) : sert à la fois au filtre « interrompue » et à l'affichage, pour
// que les deux restent cohérents. Même principe que resolveDateRange
// (lib/calculations.ts), qui lit l'instant courant hors du composant.
export function requestNowMs(): number {
  return Date.now()
}

export function displayStatus(status: AdminSyncRunStatus, startedAt: string, nowMs: number): DisplayStatus {
  if (status === 'running' && nowMs - new Date(startedAt).getTime() > STALE_RUNNING_MS) return 'interrupted'
  return status
}

// ── Diagnostics (miroir d'affichage de app/api/admin/sync/all/route.ts) ──

const STEP_LABEL: Record<string, string> = {
  meta_totals: 'Meta (totaux)',
  meta_daily: 'Meta (quotidien)',
  calendly_appointments: 'Calendly (rendez-vous)',
  calendly_daily: 'Calendly (quotidien)',
  orchestration: 'Orchestration',
}

const CATEGORY_LABEL: Record<string, string> = {
  rate_limit: 'Limite de débit',
  auth: 'Accès refusé ou jeton invalide',
  network: 'Erreur réseau',
  timeout: 'Délai dépassé',
  configuration: 'Configuration serveur incomplète',
  database: 'Erreur base de données',
  data: 'Donnée inattendue',
  upstream_error: 'Erreur du service distant',
  client_disconnected: 'Connexion du navigateur interrompue',
  unknown: 'Cause non identifiée',
}

const CONSEQUENCE: Record<string, { blocking: string; partial: string }> = {
  meta_totals: { blocking: 'Synchronisation interrompue, Calendly non lancé', partial: 'Campagne non mise à jour' },
  meta_daily: { blocking: 'Statistiques quotidiennes Meta non mises à jour', partial: 'Statistiques quotidiennes Meta non mises à jour' },
  calendly_appointments: {
    blocking: 'Synchronisation interrompue, quotidien Calendly non lancé',
    partial: 'Rendez-vous concernés en erreur ce passage',
  },
  calendly_daily: { blocking: 'Statistiques quotidiennes Calendly non recalculées', partial: 'Statistiques quotidiennes Calendly non recalculées' },
  orchestration: { blocking: 'Synchronisation interrompue avant son terme', partial: 'Synchronisation interrompue avant son terme' },
}

export type DiagnosticView = {
  step: string
  cause: string
  code: string | null
  occurrences: number
  blocking: boolean
  consequence: string
}

// ── Rapport ────────────────────────────────────────────────────────────

type MetaTotalsView = { targetCampaignNumber: number | null; succeeded: number; failed: number; skippedLocked: number[]; waiting: number[] }
type MetaDailyView = { error: true } | { error: false; failed: number; daysUpserted: number }
type CalendlyAppointmentsView = { read: number; invitees: number; retained: number; ambiguous: number; errors: number }
type CalendlyDailyView = { error: true } | { error: false; daysWritten: number }

export type ReportView = {
  abortedAtStep: 'meta_totals' | 'calendly_appointments' | null
  noCampaignToSync: boolean
  metaTotals: MetaTotalsView | null
  metaDaily: MetaDailyView | null
  calendlyAppointments: CalendlyAppointmentsView | null
  calendlyDaily: CalendlyDailyView | null
  totalErrors: number
  diagnostics: DiagnosticView[]
}

type JsonObject = { [key: string]: Json | undefined }

function asObject(value: Json | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function num(value: Json | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function numOrNull(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numbers(value: Json | undefined): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []
}

function parseDiagnostic(value: Json): DiagnosticView | null {
  const d = asObject(value)
  if (!d) return null
  const step = typeof d.step === 'string' && d.step in STEP_LABEL ? d.step : null
  const category = typeof d.category === 'string' && d.category in CATEGORY_LABEL ? d.category : 'unknown'
  const blocking = d.blocking === true
  const httpStatus = numOrNull(d.httpStatus)
  const metaCode = numOrNull(d.metaCode)
  return {
    step: step ? STEP_LABEL[step] : 'Étape inconnue',
    cause: CATEGORY_LABEL[category],
    code: httpStatus !== null ? `HTTP ${httpStatus}` : metaCode !== null ? `code Meta ${metaCode}` : null,
    occurrences: Math.max(1, num(d.occurrences)),
    blocking,
    consequence: step ? CONSEQUENCE[step][blocking ? 'blocking' : 'partial'] : '—',
  }
}

export function parseReport(value: Json | null): ReportView | null {
  const r = asObject(value ?? undefined)
  if (!r) return null

  const totals = asObject(r.metaTotals)
  const daily = asObject(r.metaDaily)
  const appts = asObject(r.calendlyAppointments)
  const calDaily = asObject(r.calendlyDaily)

  return {
    abortedAtStep: r.abortedAtStep === 'meta_totals' || r.abortedAtStep === 'calendly_appointments' ? r.abortedAtStep : null,
    noCampaignToSync: r.noCampaignToSync === true,
    metaTotals: totals
      ? {
          targetCampaignNumber: numOrNull(totals.targetCampaignNumber),
          succeeded: num(totals.succeeded),
          failed: num(totals.failed),
          skippedLocked: numbers(totals.skippedLocked),
          waiting: numbers(totals.waiting),
        }
      : null,
    metaDaily: daily ? ('error' in daily ? { error: true } : { error: false, failed: num(daily.failed), daysUpserted: num(daily.daysUpserted) }) : null,
    calendlyAppointments: appts
      ? { read: num(appts.read), invitees: num(appts.invitees), retained: num(appts.retained), ambiguous: num(appts.ambiguous), errors: num(appts.errors) }
      : null,
    calendlyDaily: calDaily ? ('error' in calDaily ? { error: true } : { error: false, daysWritten: num(calDaily.daysWritten) }) : null,
    totalErrors: num(r.totalErrors),
    diagnostics: Array.isArray(r.diagnostics)
      ? r.diagnostics.map(parseDiagnostic).filter((d): d is DiagnosticView => d !== null)
      : [],
  }
}

// ── Étapes exécutées ───────────────────────────────────────────────────

export type StepState = 'success' | 'partial' | 'failed' | 'skipped' | 'not_reached'

export const STEP_STATE_LABEL: Record<StepState, string> = {
  success: 'Réussie',
  partial: 'Partielle',
  failed: 'Échec',
  skipped: 'Non nécessaire',
  not_reached: 'Non lancée',
}

export type StepView = { label: string; state: StepState }

export function stepViews(report: ReportView): StepView[] {
  const notRun: StepState = report.noCampaignToSync ? 'skipped' : 'not_reached'

  const metaTotals: StepState = report.metaTotals
    ? report.metaTotals.failed > 0
      ? 'failed'
      : 'success'
    : report.abortedAtStep === 'meta_totals'
      ? 'failed'
      : 'not_reached'

  const metaDaily: StepState = report.metaDaily
    ? report.metaDaily.error || report.metaDaily.failed > 0
      ? 'failed'
      : 'success'
    : notRun

  const calendlyAppointments: StepState = report.calendlyAppointments
    ? report.calendlyAppointments.errors - report.calendlyAppointments.ambiguous > 0
      ? 'partial'
      : 'success'
    : report.abortedAtStep === 'calendly_appointments'
      ? 'failed'
      : notRun

  const calendlyDaily: StepState = report.calendlyDaily ? (report.calendlyDaily.error ? 'failed' : 'success') : notRun

  return [
    { label: 'Meta (totaux)', state: metaTotals },
    { label: 'Meta (quotidien)', state: metaDaily },
    { label: 'Calendly (rendez-vous)', state: calendlyAppointments },
    { label: 'Calendly (quotidien)', state: calendlyDaily },
  ]
}

// ── Formatage ──────────────────────────────────────────────────────────

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
})

export function formatRunDate(iso: string): string {
  return DATE_TIME_FORMATTER.format(new Date(iso))
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return '< 1 s'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`
}

export function listCampaigns(numbersList: number[]): string {
  return numbersList.length === 0 ? 'aucune' : numbersList.map((n) => `n°${n}`).join(', ')
}
