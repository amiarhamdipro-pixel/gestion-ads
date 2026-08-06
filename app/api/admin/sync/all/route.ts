import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function emit(event: SyncAllEvent): void {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }

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
      } catch (error) {
        const message = error instanceof Error ? error.message : 'erreur inconnue'
        logError('sync', '/api/admin/sync/all (totaux Meta)', message)
        emit({
          type: 'result',
          report: {
            ok: false,
            abortedAtStep: 'meta_totals',
            abortMessage: 'Échec de la synchronisation Meta (totaux) — synchronisation interrompue, Calendly non lancé.',
            noCampaignToSync: false,
            metaTotals: null,
            metaDaily: null,
            calendlyAppointments: null,
            calendlyDaily: null,
            totalErrors: 1,
          },
        })
        controller.close()
        return
      }

      // Aucune campagne dynamique candidate (toutes verrouillées, ou aucune
      // campagne valide détectée) : succès propre, rien à traiter — Meta
      // quotidien et Calendly ne sont même pas lancés (voir
      // BRIEF-CLAUDE-CODE.md, critère d'acceptation "Aucune campagne à
      // synchroniser").
      if (metaTotals.targetCampaignNumber === null) {
        emit({
          type: 'result',
          report: {
            ok: true,
            abortedAtStep: null,
            abortMessage: null,
            noCampaignToSync: true,
            metaTotals,
            metaDaily: null,
            calendlyAppointments: null,
            calendlyDaily: null,
            totalErrors: 0,
          },
        })
        controller.close()
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
      } catch (error) {
        const message = error instanceof Error ? error.message : 'erreur inconnue'
        logError('sync', '/api/admin/sync/all (quotidien Meta)', message)
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
      } catch (error) {
        const message = error instanceof Error ? error.message : 'erreur inconnue'
        logError('sync', '/api/admin/sync/all (rendez-vous Calendly)', message)
        emit({
          type: 'result',
          report: {
            ok: false,
            abortedAtStep: 'calendly_appointments',
            abortMessage: 'Échec de la synchronisation Calendly (rendez-vous) — synchronisation interrompue.',
            noCampaignToSync: false,
            metaTotals,
            metaDaily,
            calendlyAppointments: null,
            calendlyDaily: null,
            totalErrors: metaTotals.failed + ('error' in metaDaily ? 1 : metaDaily.failed) + 1,
          },
        })
        controller.close()
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

      emit({
        type: 'result',
        report: {
          ok,
          abortedAtStep: null,
          abortMessage: null,
          noCampaignToSync: false,
          metaTotals,
          metaDaily,
          calendlyAppointments,
          calendlyDaily,
          totalErrors,
        },
      })
      controller.close()
    },
  })

  return new NextResponse(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
}
