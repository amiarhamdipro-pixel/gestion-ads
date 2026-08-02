// Orchestration Meta -> Supabase pour une campagne dashboard (un numéro = 2 ad
// sets, barbier + coiffeur ; voir BRIEF-CLAUDE-CODE.md section 2). Idempotent :
// chaque table est upsertée sur sa clé externe stable (client_id+campaign_number,
// meta_adset_id, meta_ad_id), donc un rejeu après échec partiel converge sans
// doublon plutôt que de dupliquer des lignes.
//
// Limite connue : supabase-js n'expose pas de transaction multi-requêtes côté
// client JS. Une atomicité DB stricte nécessiterait une fonction SQL (RPC)
// dédiée — hors périmètre ici. Les champs de saisie manuelle
// (calendly_appointments, manual_appointments_adjustment) ne sont jamais
// écrasés par cette fonction : ils sont omis du payload d'upsert campagne.
//
// end_date : l'attribut end_time de l'ad set lui-même n'est JAMAIS renvoyé
// par Meta sur ce compte (vérifié en conditions réelles, 9/9 campagnes,
// paused et active confondues — ce n'est pas une date programmée que les
// opérateurs renseignent, seul un statut PAUSED est utilisé pour arrêter une
// campagne). date_stop des insights agrégées (date_preset=maximum) ne
// convient pas non plus : il vaut toujours la date du jour, quel que soit le
// statut réel de l'ad set (vérifié également) — l'utiliser écrirait une date
// "aujourd'hui" à chaque resync, explicitement interdit. La seule donnée
// Meta fiable pour une date de fin réelle est le DERNIER date_start
// effectivement renvoyé par les insights quotidiennes (time_increment=1,
// déjà utilisées par syncCampaignDailyStats.ts) : Meta ne renvoie jamais de
// jour sans diffusion réelle, donc le dernier jour reçu est le dernier jour
// où l'ad set a réellement délivré. Calculée uniquement quand les deux ad
// sets (barbier + coiffeur) ne sont plus ACTIVE (jamais sur une campagne en
// cours) et seulement si end_date n'est pas déjà renseignée (évite de
// refaire l'appel Meta à chaque resync une fois la date figée — coûteux et
// sensible à la limite de débit). Si aucune donnée quotidienne n'existe
// (campagne arrêtée sans avoir jamais délivré), end_date reste omise du
// payload : la saisie manuelle (app/api/admin/campaigns/end-date/route.ts)
// redevient alors un vrai secours, jamais écrasée dans ce cas précis.

import { createAdminClient } from '@/lib/supabase/admin'
import { logError } from '@/lib/logger'
import { fetchAdInsights, fetchAdSetAds, fetchAdSetDailyInsights, fetchAdSetInsights, fetchCampaignAdSets } from './meta'
import { groupByCampaignNumber } from './groupByCampaign'
import { mapAdSetToAudienceInsert, mapAdToVideoInsert } from './mapper'
import type { SyncCampaignParams, SyncCampaignResult } from './types'

function mergeStatus(statusA: string, statusB: string): string {
  return statusA === statusB ? statusA : 'MIXED'
}

// Meta renvoie des datetime ISO ("2026-07-18T22:30:00+0200") ; la colonne
// campaigns.start_date/end_date est de type date — on ne garde que la partie
// calendaire, sans conversion de fuseau horaire.
function toDateOnly(isoDateTime: string | undefined): string | null {
  return isoDateTime ? isoDateTime.slice(0, 10) : null
}

function earliestDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

// Journalisation dans sync_runs (schéma existant, non modifié) : une ligne par
// tentative. error_message reste réservé aux échecs (null en cas de succès).
async function startSyncRun(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('sync_runs')
    .insert({ client_id: clientId, started_by: null, status: 'running' })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Échec création sync_run : ${error?.message ?? 'réponse vide'}`)
  }

  return data.id
}

async function finishSyncRun(
  supabase: ReturnType<typeof createAdminClient>,
  syncRunId: string,
  status: 'success' | 'failed',
  message: string | null
): Promise<void> {
  const { error } = await supabase
    .from('sync_runs')
    .update({ status, finished_at: new Date().toISOString(), error_message: message })
    .eq('id', syncRunId)

  if (error) {
    // Ne masque pas l'erreur/succès principal de syncCampaign : simple trace.
    logError('sync', `sync_run ${syncRunId}`, `échec mise à jour : ${error.message}`)
  }
}

export async function syncCampaign(params: SyncCampaignParams): Promise<SyncCampaignResult> {
  const { clientId, metaCampaignId, campaignNumber, leadActionType = '' } = params
  const supabase = createAdminClient()

  const syncRunId = await startSyncRun(supabase, clientId)

  try {
    const result = await runSync(supabase, { clientId, metaCampaignId, campaignNumber, leadActionType })

    await finishSyncRun(supabase, syncRunId, 'success', null)

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishSyncRun(supabase, syncRunId, 'failed', message)
    throw error
  }
}

type RunSyncParams = {
  clientId: string
  metaCampaignId: string
  campaignNumber: number
  leadActionType: string
}

async function runSync(
  supabase: ReturnType<typeof createAdminClient>,
  { clientId, metaCampaignId, campaignNumber, leadActionType }: RunSyncParams
): Promise<SyncCampaignResult> {
  const adSets = await fetchCampaignAdSets(metaCampaignId)
  const group = groupByCampaignNumber(adSets, campaignNumber)

  if (!group.barbier || !group.coiffeur) {
    throw new Error(
      `Regroupement invalide pour la campagne n°${campaignNumber} : audience barbier ou coiffeur introuvable.`
    )
  }

  const barbierAdSet = group.barbier
  const coiffeurAdSet = group.coiffeur

  const [barbierInsights, coiffeurInsights] = await Promise.all([
    fetchAdSetInsights(barbierAdSet.id),
    fetchAdSetInsights(coiffeurAdSet.id),
  ])

  const barbierAudienceData = mapAdSetToAudienceInsert('', barbierAdSet, barbierInsights, leadActionType)
  const coiffeurAudienceData = mapAdSetToAudienceInsert('', coiffeurAdSet, coiffeurInsights, leadActionType)

  const barbierStart = toDateOnly(barbierAdSet.start_time)
  const coiffeurStart = toDateOnly(coiffeurAdSet.start_time)

  const bothEnded = barbierAdSet.status !== 'ACTIVE' && coiffeurAdSet.status !== 'ACTIVE'
  let derivedEndDate: string | null = null

  if (bothEnded) {
    const { data: existingCampaign } = await supabase
      .from('campaigns')
      .select('end_date')
      .eq('client_id', clientId)
      .eq('campaign_number', campaignNumber)
      .maybeSingle()

    if (!existingCampaign?.end_date) {
      const [barbierDaily, coiffeurDaily] = await Promise.all([
        fetchAdSetDailyInsights(barbierAdSet.id),
        fetchAdSetDailyInsights(coiffeurAdSet.id),
      ])
      const lastRealDates = [...barbierDaily, ...coiffeurDaily].map((d) => d.date_start)
      derivedEndDate =
        lastRealDates.length > 0 ? lastRealDates.reduce((max, d) => (d > max ? d : max)) : null
    }
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .upsert(
      {
        client_id: clientId,
        meta_campaign_id: metaCampaignId,
        campaign_number: campaignNumber,
        name: `Campagne n°${campaignNumber}`,
        status: mergeStatus(barbierAdSet.status, coiffeurAdSet.status),
        start_date: earliestDate(barbierStart, coiffeurStart),
        meta_spend: barbierAudienceData.meta_spend + coiffeurAudienceData.meta_spend,
        meta_pixel_leads: barbierAudienceData.meta_pixel_leads + coiffeurAudienceData.meta_pixel_leads,
        ...(derivedEndDate !== null ? { end_date: derivedEndDate } : {}),
      },
      { onConflict: 'client_id,campaign_number' }
    )
    .select()
    .single()

  if (campaignError || !campaign) {
    throw new Error(`Échec upsert campagne n°${campaignNumber} : ${campaignError?.message ?? 'réponse vide'}`)
  }

  const { data: audienceRows, error: audienceError } = await supabase
    .from('audiences')
    .upsert(
      [
        { ...barbierAudienceData, campaign_id: campaign.id },
        { ...coiffeurAudienceData, campaign_id: campaign.id },
      ],
      { onConflict: 'meta_adset_id' }
    )
    .select()

  if (audienceError || !audienceRows || audienceRows.length !== 2) {
    throw new Error(
      `Échec upsert audiences campagne n°${campaignNumber} : ${audienceError?.message ?? 'nombre de lignes inattendu'}`
    )
  }

  const barbierAudienceRow = audienceRows.find((row) => row.meta_adset_id === barbierAdSet.id)
  const coiffeurAudienceRow = audienceRows.find((row) => row.meta_adset_id === coiffeurAdSet.id)

  if (!barbierAudienceRow || !coiffeurAudienceRow) {
    throw new Error(`Échec upsert audiences campagne n°${campaignNumber} : lignes retournées incohérentes.`)
  }

  const videoInserts: ReturnType<typeof mapAdToVideoInsert>[] = []

  for (const [audienceRow, adSet] of [
    [barbierAudienceRow, barbierAdSet],
    [coiffeurAudienceRow, coiffeurAdSet],
  ] as const) {
    const ads = await fetchAdSetAds(adSet.id)
    for (const ad of ads) {
      const adInsights = await fetchAdInsights(ad.id)
      videoInserts.push(mapAdToVideoInsert(audienceRow.id, ad, adInsights))
    }
  }

  if (videoInserts.length === 0) {
    throw new Error(`Aucune pub trouvée pour la campagne n°${campaignNumber}.`)
  }

  const { data: videoRows, error: videoError } = await supabase
    .from('videos')
    .upsert(videoInserts, { onConflict: 'meta_ad_id' })
    .select()

  if (videoError || !videoRows) {
    throw new Error(`Échec upsert vidéos campagne n°${campaignNumber} : ${videoError?.message ?? 'réponse vide'}`)
  }

  return { campaign, audiences: audienceRows, videos: videoRows }
}
