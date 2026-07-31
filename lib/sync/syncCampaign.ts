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

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAdInsights, fetchAdSetAds, fetchAdSetInsights, fetchCampaignAdSets } from './meta'
import { groupByCampaignNumber } from './groupByCampaign'
import { mapAdSetToAudienceInsert, mapAdToVideoInsert } from './mapper'
import type { SyncCampaignParams, SyncCampaignResult } from './types'

function mergeStatus(statusA: string, statusB: string): string {
  return statusA === statusB ? statusA : 'MIXED'
}

export async function syncCampaign(params: SyncCampaignParams): Promise<SyncCampaignResult> {
  const { clientId, metaCampaignId, campaignNumber, leadActionType = '' } = params
  const supabase = createAdminClient()

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

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .upsert(
      {
        client_id: clientId,
        meta_campaign_id: metaCampaignId,
        campaign_number: campaignNumber,
        name: `Campagne n°${campaignNumber}`,
        status: mergeStatus(barbierAdSet.status, coiffeurAdSet.status),
        meta_spend: barbierAudienceData.meta_spend + coiffeurAudienceData.meta_spend,
        meta_pixel_leads: barbierAudienceData.meta_pixel_leads + coiffeurAudienceData.meta_pixel_leads,
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
