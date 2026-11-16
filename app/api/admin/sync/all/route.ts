import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminSyncRunStatus } from '@/types/database'
import { syncAllCampaigns } from '@/lib/sync/syncAllCampaigns'
import { syncAllCampaignsDailyStats } from '@/lib/sync/syncAllCampaignsDailyStats'
import { syncAppointments } from '@/lib/sync/syncAppointments'
import { syncCalendlyDailyStats } from '@/lib/sync/syncCalendlyDailyStats'
import { logError } from '@/lib/logger'

// Orchestration admin unique : Meta (totaux puis quotidien) TOUJOURS avant
// Calendly (rendez-vous + rattachement campagnes, puis quotidien) — jamais
// l'inverse, jamais en parallèle. N'appelle que les fonctions de synchro déjà
// validées (lib/sync/*), aucune logique métier nouvelle ici : ce fichier ne
// fait que les enchaîner et construire un rapport unique.
//
// Réponse en NDJSON (une ligne JSON par évènement, Content-Type
// application/x-ndjson) plutôt qu'un unique gros JSON : le seul moyen
// d'afficher une étape en cours (Meta… / Calendly… / Finalisation…) qui
// reflète réellement l'avancement serveur, sans deviner un minutage côté
// client (ce qui pourrait afficher une étape qui n'est pas la vraie — même
// écueil que "ne jamais afficher un faux succès global", appliqué à
// l'affichage intermédiaire). Aucune dépendance ajoutée : ReadableStream/
// TextEncoder sont des API web natives, déjà disponibles côté runtime Node
// de Next.js. Un seul évènement final `result` porte le rapport complet ;
// les champs des étapes non atteintes restent `null` (jamais une valeur
// inventée) si un échec dur interrompt la chaîne avant leur tour.
//
// Règle métier officielle (voir BRIEF-CLAUDE-CODE.md) : une seule campagne
// dynamique traitée par appel, celle au campaign_number le plus petit parmi
// les candidates non verrouillées (lib/sync/syncAllCampaigns.ts,
// selectSequentialTarget) — jamais un seuil numérique codé en dur. Meta
// quotidien et Calendly (rattachement + quotidien) ciblent tous la MÊME
// campagne que Meta totaux (metaTotals.targetCampaignNumber, jamais
// re-choisie indépendamment plus loin dans la chaîne). Si aucune campagne
// dynamique candidate n'existe, la chaîne s'arrête net après Meta totaux
// (`noCampaignToSync: true`, succès propre) : Meta quotidien et Calendly ne
// sont même pas lancés.

// targetCampaignNumber/waiting : sélection séquentielle (règle métier
// officielle, voir BRIEF-CLAUDE-CODE.md et lib/sync/syncAllCampaigns.ts,
// selectSequentialTarget) — au plus une campagne synchronisée par appel.
type MetaTotalsSummary = {
  totalDetected: number
  targetCampaignNumber: number | null
  succeeded: number
  failed: number
  skippedLocked: number[]
  waiting: number[]
}
type MetaDailySummary =
  | {
      totalDetected: number
      targetCampaignNumber: number | null
      succeeded: number
      failed: number
      daysUpserted: number
      skippedLocked: number[]
      waiting: number[]
    }
  | { error: string }
type CalendlyAppointmentsSummary = {
  read: number
  invitees: number
  retained: number
  ambiguous: number
  errors: number
}
type CalendlyDailySummary = { daysWritten: number; campaignsProcessed: number } | { error: string }

export type SyncAllReport = {
  ok: boolean
  abortedAtStep: 'meta_totals' | 'calendly_appointments' | null
  abortMessage: string | null
  // true si aucune campagne dynamique candidate n'a été trouvée (toutes
  // verrouillées, ou aucune campagne valide détectée côté Meta) : succès
  // propre, Meta quotidien/Calendly jamais lancés (rien à traiter) — voir
  // SyncButton.tsx, message "Aucune campagne à synchroniser".
  noCampaignToSync: boolean
  metaTotals: MetaTotalsSummary | null
  metaDaily: MetaDailySummary | null
  calendlyAppointments: CalendlyAppointmentsSummary | null
  calendlyDaily: CalendlyDailySummary | null
  totalErrors: number
}

type SyncAllEvent = { type: 'stage'; stage: 'meta' | 'calendly' | 'finalizing' } | { type: 'result'; report: SyncAllReport }

// ── Historisation (admin_sync_runs) ─────────────────────────────────────
// Une ligne par clic : insérée en `running` après les contrôles d'accès,
// finalisée une seule fois (finish/finalize ci-dessous) avec le rapport
// SyncAllReport inchangé + des diagnostics structurés. Une ligne restée
// `running` signale un arrêt brutal (process tué, délai plateforme). Un
// échec d'historisation ne bloque jamais la synchro : simple logError.
//
// Diagnostics : uniquement une catégorie + un code HTTP / code Meta, jamais
// le message brut (il peut contenir des URI Calendly ou une réponse API).
// La classification ne s'appuie que sur des formats produits par le code du
// projet — « (HTTP N) » (lib/calendly/client.ts), « Meta API — … (code N) »
// (lib/sync/meta.ts), « Missing … environment variable », préfixes fixes
// « Échec upsert/lecture … » (Supabase) — ou sur des propriétés structurées
// de l'erreur (name, cause.code). Tout autre cas reste `unknown` : jamais de
// cause devinée.
type DiagnosticStep = 'meta_totals' | 'meta_daily' | 'calendly_appointments' | 'calendly_daily' | 'orchestration'
type ErrorCategory =
  | 'rate_limit'
  | 'auth'
  | 'network'
  | 'timeout'
  | 'configuration'
  | 'database'
  | 'data'
  | 'upstream_error'
  | 'client_disconnected'
  | 'unknown'
type ErrorCause = { category: ErrorCategory; httpStatus?: number; metaCode?: number }
type StepDiagnostic = ErrorCause & { step: DiagnosticStep; blocking: boolean; occurrences: number }

const STEP_LABEL: Record<DiagnosticStep, string> = {
  meta_totals: 'Meta (totaux)',
  meta_daily: 'Meta (quotidien)',
  calendly_appointments: 'Calendly (rendez-vous)',
  calendly_daily: 'Calendly (quotidien)',
  orchestration: 'Orchestration',
}

const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  rate_limit: 'limite de débit',
  auth: 'accès refusé ou jeton invalide',
  network: 'erreur réseau',
  timeout: 'délai dépassé',
  configuration: 'configuration serveur incomplète',
  database: 'erreur base de données',
  data: 'donnée inattendue',
  upstream_error: 'erreur du service distant',
  client_disconnected: 'connexion du navigateur interrompue',
  unknown: 'cause non identifiée (voir journaux serveur)',
}

// Codes d'erreur Graph API documentés par Meta.
const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613])
const META_AUTH_CODES = new Set([10, 102, 190])
const TIMEOUT_CAUSE_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])
const ERROR_MESSAGE_MAX_LENGTH = 500

function categoryFromHttpStatus(status: number): ErrorCategory {
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 408 || status === 504) return 'timeout'
  return 'upstream_error'
}

function categoryFromMetaCode(code: number): ErrorCategory {
  if (META_RATE_LIMIT_CODES.has(code) || (code >= 80000 && code <= 80014)) return 'rate_limit'
  if (META_AUTH_CODES.has(code) || (code >= 200 && code <= 299)) return 'auth'
  return 'upstream_error'
}

function classifyMessage(message: string): ErrorCause {
  const http = /\(HTTP (\d{3})\b/.exec(message)
  if (http) {
    const status = Number(http[1])
    return { category: categoryFromHttpStatus(status), httpStatus: status }
  }
  const meta = /Meta API — [\s\S]*\(code (\d+)\)/.exec(message)
  if (meta) {
    const code = Number(meta[1])
    return { category: categoryFromMetaCode(code), metaCode: code }
  }
  if (/^Missing [A-Z_]+( or [A-Z_]+)? environment variable/.test(message)) return { category: 'configuration' }
  if (/(^|: )fetch failed$/.test(message)) return { category: 'network' }
  if (/^Échec (upsert|lecture campagne|lecture des campagnes|lecture des rendez-vous existants|création sync_run)/.test(message)) {
    return { category: 'database' }
  }
  if (/^(Regroupement invalide|Aucune pub trouvée|Campagne n°\d+ introuvable en base)|statut inattendu/.test(message)) {
    return { category: 'data' }
  }
  return { category: 'unknown' }
}

function classifyError(error: unknown): ErrorCause {
  if (!(error instanceof Error)) return { category: 'unknown' }
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return { category: 'timeout' }
  if (error.message === 'fetch failed') {
    const causeCode = (error.cause as { code?: unknown } | undefined)?.code
    return { category: typeof causeCode === 'string' && TIMEOUT_CAUSE_CODES.has(causeCode) ? 'timeout' : 'network' }
  }
  return classifyMessage(error.message)
}

// Regroupe des messages d'erreur d'une même étape par cause identique.
function diagnosticsFromMessages(step: DiagnosticStep, messages: string[]): StepDiagnostic[] {
  const groups = new Map<string, StepDiagnostic>()
  for (const message of messages) {
    const cause = classifyMessage(message)
    const key = `${cause.category}|${cause.httpStatus ?? ''}|${cause.metaCode ?? ''}`
    const existing = groups.get(key)
    if (existing) {
      existing.occurrences += 1
    } else {
      groups.set(key, { step, blocking: false, occurrences: 1, ...cause })
    }
  }
  return [...groups.values()]
}

function consequence(diagnostic: StepDiagnostic): string {
  switch (diagnostic.step) {
    case 'meta_totals':
      return diagnostic.blocking ? 'synchronisation interrompue, Calendly non lancé' : 'campagne non mise à jour'
    case 'meta_daily':
      return 'statistiques quotidiennes Meta non mises à jour'
    case 'calendly_appointments':
      return diagnostic.blocking
        ? 'synchronisation interrompue, quotidien Calendly non lancé'
        : 'rendez-vous concernés en erreur ce passage'
    case 'calendly_daily':
      return 'statistiques quotidiennes Calendly non recalculées'
    case 'orchestration':
      return 'synchronisation interrompue avant son terme'
  }
}

// « Étape : cause (code) ×n — conséquence », une entrée par diagnostic,
// échecs bloquants en premier.
function formatErrorMessage(status: AdminSyncRunStatus, diagnostics: StepDiagnostic[]): string | null {
  if (status !== 'failed' && status !== 'partial') return null
  if (diagnostics.length === 0) return `${status === 'failed' ? 'Échec' : 'Échec partiel'} : ${CATEGORY_LABEL.unknown}`

  const text = [...diagnostics]
    .sort((a, b) => Number(b.blocking) - Number(a.blocking))
    .map((d) => {
      const code = d.httpStatus !== undefined ? ` (HTTP ${d.httpStatus})` : d.metaCode !== undefined ? ` (code Meta ${d.metaCode})` : ''
      const count = d.occurrences > 1 ? ` ×${d.occurrences}` : ''
      return `${STEP_LABEL[d.step]} : ${CATEGORY_LABEL[d.category]}${code}${count} — ${consequence(d)}`
    })
    .join(' | ')
  return text.length > ERROR_MESSAGE_MAX_LENGTH ? `${text.slice(0, ERROR_MESSAGE_MAX_LENGTH - 1)}…` : text
}

function runStatus(report: SyncAllReport): AdminSyncRunStatus {
  if (report.noCampaignToSync) return 'no_campaign'
  if (report.abortedAtStep) return 'failed'
  return report.ok ? 'success' : 'partial'
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, client_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  if (!profile.client_id) {
    return NextResponse.json({ error: 'Aucun client autorisé associé à ce compte.' }, { status: 403 })
  }

  const metaCampaignId = process.env.META_CAMPAIGN_ID
  if (!metaCampaignId) {
    return NextResponse.json({ error: 'Synchronisation indisponible (configuration serveur).' }, { status: 500 })
  }

  const clientId = profile.client_id
  const syncParams = { clientId, metaCampaignId, leadActionType: process.env.LEAD_ACTION_TYPE }

  const encoder = new TextEncoder()
  // Positionné par cancel() si le navigateur ferme la connexion : seule
  // source fiable pour la catégorie `client_disconnected`.
  let clientDisconnected = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function emit(event: SyncAllEvent): void {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }

      // ── Historisation : ligne `running` ──────────────────────────────
      const startedAtMs = Date.now()
      const diagnostics: StepDiagnostic[] = []
      let historyClient: ReturnType<typeof createAdminClient> | null = null
      let runId: string | null = null
      let finalized = false
      try {
        historyClient = createAdminClient()
        const { data, error } = await historyClient
          .from('admin_sync_runs')
          .insert({
            client_id: clientId,
            started_by: user.id,
            trigger: 'manual',
            status: 'running',
            started_at: new Date(startedAtMs).toISOString(),
          })
          .select('id')
          .single()
        if (error || !data) {
          logError('sync', '/api/admin/sync/all (historique)', `création impossible : ${error?.message ?? 'réponse vide'}`)
        } else {
          runId = data.id
        }
      } catch (error) {
        logError('sync', '/api/admin/sync/all (historique)', error instanceof Error ? error.message : 'erreur inconnue')
      }

      // Finalisation unique de la ligne d'historique (jamais deux fois : une
      // erreur d'envoi au navigateur après finalisation ne doit pas réécrire
      // un succès en échec).
      async function finalize(report: SyncAllReport, status: AdminSyncRunStatus = runStatus(report)): Promise<void> {
        if (finalized) return
        finalized = true
        if (!historyClient || !runId) return
        const finishedAtMs = Math.max(Date.now(), startedAtMs)
        try {
          const { error } = await historyClient
            .from('admin_sync_runs')
            .update({
              status,
              aborted_at_step: report.abortedAtStep,
              target_campaign_number: report.metaTotals?.targetCampaignNumber ?? null,
              total_errors: report.totalErrors,
              error_message: formatErrorMessage(status, diagnostics),
              report: { ...report, diagnostics },
              finished_at: new Date(finishedAtMs).toISOString(),
              duration_ms: finishedAtMs - startedAtMs,
            })
            .eq('id', runId)
          if (error) {
            logError('sync', `/api/admin/sync/all (historique ${runId})`, `finalisation impossible : ${error.message}`)
          }
        } catch (error) {
          logError('sync', `/api/admin/sync/all (historique ${runId})`, error instanceof Error ? error.message : 'erreur inconnue')
        }
      }

      // Seule sortie normale du flux : historise, puis émet le rapport.
      async function finish(report: SyncAllReport): Promise<void> {
        await finalize(report)
        emit({ type: 'result', report })
        controller.close()
      }

      try {
        emit({ type: 'stage', stage: 'meta' })

        // ── 1/4 : totaux Meta ────────────────────────────────────────────
        let metaTotals: MetaTotalsSummary
        try {
          const totalsReport = await syncAllCampaigns(syncParams)
          metaTotals = {
            totalDetected: totalsReport.totalDetected,
            targetCampaignNumber: totalsReport.targetCampaignNumber,
            succeeded: totalsReport.succeeded,
            failed: totalsReport.failed,
            skippedLocked: totalsReport.skippedLocked,
            waiting: totalsReport.waiting,
          }
          diagnostics.push(
            ...diagnosticsFromMessages(
              'meta_totals',
              totalsReport.details.flatMap((detail) => (detail.status === 'failed' ? [detail.message] : []))
            )
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : 'erreur inconnue'
          logError('sync', '/api/admin/sync/all (totaux Meta)', message)
          diagnostics.push({ step: 'meta_totals', blocking: true, occurrences: 1, ...classifyError(error) })
          await finish({
            ok: false,
            abortedAtStep: 'meta_totals',
            abortMessage: 'Échec de la synchronisation Meta (totaux) — synchronisation interrompue, Calendly non lancé.',
            noCampaignToSync: false,
            metaTotals: null,
            metaDaily: null,
            calendlyAppointments: null,
            calendlyDaily: null,
            totalErrors: 1,
          })
          return
        }

        // Aucune campagne dynamique candidate (toutes verrouillées, ou aucune
        // campagne valide détectée) : succès propre, rien à traiter — Meta
        // quotidien et Calendly ne sont même pas lancés (voir
        // BRIEF-CLAUDE-CODE.md, critère d'acceptation "Aucune campagne à
        // synchroniser").
        if (metaTotals.targetCampaignNumber === null) {
          await finish({
            ok: true,
            abortedAtStep: null,
            abortMessage: null,
            noCampaignToSync: true,
            metaTotals,
            metaDaily: null,
            calendlyAppointments: null,
            calendlyDaily: null,
            totalErrors: 0,
          })
          return
        }

        // ── 2/4 : quotidien Meta ─────────────────────────────────────────
        // Un échec ici ne bloque pas Calendly : le rattachement par fenêtre de
        // dates ne dépend que de campaigns.start_date/end_date (étape 1,
        // déjà écrite), jamais de campaign_daily_stats.
        let metaDaily: MetaDailySummary
        try {
          const dailyReport = await syncAllCampaignsDailyStats(syncParams)
          metaDaily = {
            totalDetected: dailyReport.totalDetected,
            targetCampaignNumber: dailyReport.targetCampaignNumber,
            succeeded: dailyReport.succeeded,
            failed: dailyReport.failed,
            daysUpserted: dailyReport.details.reduce(
              (sum, detail) => sum + (detail.status === 'success' ? detail.result.daysUpserted : 0),
              0
            ),
            skippedLocked: dailyReport.skippedLocked,
            waiting: dailyReport.waiting,
          }
          diagnostics.push(
            ...diagnosticsFromMessages(
              'meta_daily',
              dailyReport.details.flatMap((detail) => (detail.status === 'failed' ? [detail.message] : []))
            )
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : 'erreur inconnue'
          logError('sync', '/api/admin/sync/all (quotidien Meta)', message)
          diagnostics.push({ step: 'meta_daily', blocking: false, occurrences: 1, ...classifyError(error) })
          metaDaily = { error: 'Échec de la synchronisation Meta (quotidien).' }
        }

        // ── 3/4 : rendez-vous Calendly + rattachement campagnes ──────────
        // Jamais lancé avant ce point : Meta (totaux + quotidien, succès ou
        // échec) a fini juste au-dessus.
        emit({ type: 'stage', stage: 'calendly' })

        // Cible exactement la même campagne que Meta totaux (metaTotals.
        // targetCampaignNumber, non nul à ce point — voir le court-circuit
        // ci-dessus) : rattache/recalcule uniquement ce qui est nécessaire
        // pour cette campagne, jamais une campagne verrouillée ni une
        // campagne dynamique "en attente" (voir lib/sync/syncAppointments.ts,
        // syncCalendlyDailyStats.ts).
        const targetCampaignNumber = metaTotals.targetCampaignNumber

        let calendlyAppointments: CalendlyAppointmentsSummary
        let appointmentRealErrors: number
        try {
          const appointmentsResult = await syncAppointments(clientId, targetCampaignNumber)
          const ambiguous = appointmentsResult.errorDetails.filter((m) => m.includes('chevauchent')).length
          appointmentRealErrors = appointmentsResult.errors - ambiguous
          calendlyAppointments = {
            read: appointmentsResult.read,
            invitees: appointmentsResult.invitees,
            retained: appointmentsResult.campaignsAssigned,
            ambiguous,
            errors: appointmentsResult.errors,
          }
          // Chevauchements exclus : règle métier signalée à part (ambiguous),
          // pas une erreur technique.
          diagnostics.push(
            ...diagnosticsFromMessages(
              'calendly_appointments',
              appointmentsResult.errorDetails.filter((m) => !m.includes('chevauchent'))
            )
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : 'erreur inconnue'
          logError('sync', '/api/admin/sync/all (rendez-vous Calendly)', message)
          diagnostics.push({ step: 'calendly_appointments', blocking: true, occurrences: 1, ...classifyError(error) })
          await finish({
            ok: false,
            abortedAtStep: 'calendly_appointments',
            abortMessage: 'Échec de la synchronisation Calendly (rendez-vous) — synchronisation interrompue.',
            noCampaignToSync: false,
            metaTotals,
            metaDaily,
            calendlyAppointments: null,
            calendlyDaily: null,
            totalErrors: metaTotals.failed + ('error' in metaDaily ? 1 : metaDaily.failed) + 1,
          })
          return
        }

        // ── 4/4 : quotidien Calendly ──────────────────────────────────────
        let calendlyDaily: CalendlyDailySummary
        try {
          const dailyResult = await syncCalendlyDailyStats(clientId, targetCampaignNumber)
          calendlyDaily = { daysWritten: dailyResult.daysWritten, campaignsProcessed: dailyResult.campaignsProcessed }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'erreur inconnue'
          logError('sync', '/api/admin/sync/all (quotidien Calendly)', message)
          diagnostics.push({ step: 'calendly_daily', blocking: false, occurrences: 1, ...classifyError(error) })
          calendlyDaily = { error: 'Échec de la synchronisation Calendly (quotidien).' }
        }

        emit({ type: 'stage', stage: 'finalizing' })

        const totalErrors =
          metaTotals.failed +
          ('error' in metaDaily ? 1 : metaDaily.failed) +
          appointmentRealErrors +
          ('error' in calendlyDaily ? 1 : 0)

        const ok =
          metaTotals.failed === 0 &&
          !('error' in metaDaily) &&
          metaDaily.failed === 0 &&
          appointmentRealErrors === 0 &&
          !('error' in calendlyDaily)

        await finish({
          ok,
          abortedAtStep: null,
          abortMessage: null,
          noCampaignToSync: false,
          metaTotals,
          metaDaily,
          calendlyAppointments,
          calendlyDaily,
          totalErrors,
        })
      } catch (error) {
        // Exception imprévue hors des étapes (ex. envoi au navigateur après
        // déconnexion) : historisée en `failed` avec un message générique,
        // puis le flux est mis en erreur comme avant (même affichage côté
        // SyncButton.tsx : « Échec de la synchronisation. »).
        logError('sync', '/api/admin/sync/all (orchestration)', error instanceof Error ? error.message : 'erreur inconnue')
        if (!finalized) {
          diagnostics.push({
            step: 'orchestration',
            blocking: true,
            occurrences: 1,
            ...(clientDisconnected ? { category: 'client_disconnected' as const } : classifyError(error)),
          })
          await finalize(
            {
              ok: false,
              abortedAtStep: null,
              abortMessage: 'Erreur inattendue — synchronisation interrompue.',
              noCampaignToSync: false,
              metaTotals: null,
              metaDaily: null,
              calendlyAppointments: null,
              calendlyDaily: null,
              totalErrors: 1,
            },
            'failed'
          )
        }
        try {
          controller.error(error)
        } catch {
          // Flux déjà fermé ou annulé par le navigateur : rien à signaler.
        }
      }
    },
    cancel() {
      clientDisconnected = true
    },
  })

  return new NextResponse(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
}
