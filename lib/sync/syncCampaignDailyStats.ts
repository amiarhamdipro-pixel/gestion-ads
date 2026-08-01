// Alimente campaign_daily_stats (une ligne par campagne dashboard et par jour
// réellement retourné par Meta Insights, time_increment=1 — voir
// BRIEF-CLAUDE-CODE.md). Miroir de syncCampaign.ts pour la structure
// (fetch ad sets -> regroupement -> upsert), mais volontairement séparé :
// ne touche jamais campaigns/audiences/videos, réutilise seulement la ligne
// campagne déjà créée par syncCampaign()/syncAllCampaigns() (recherchée par
// client_id+campaign_number, jamais recréée ici). meta_spend et
// meta_pixel_leads sont les deux seuls champs écrits ; calendly_appointments
// est systématiquement omis du payload d'upsert (jamais écrasé), même
// principe que les champs de saisie manuelle de campaigns dans syncCampaign.ts.
//
// Traitement séquentiel : barbier puis coiffeur (pas de Promise.all), pour
// rester sobre en requêtes Meta sur un endpoint insights à volume quotidien.

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAdSetDailyInsights, fetchCampaignAdSets } from './meta'
import { groupByCampaignNumber } from './groupByCampaign'
import { aggregateDailyInsights } from './mapper'
import type { SyncCampaignDailyStatsResult, SyncCampaignParams } from './types'

export async function syncCampaignDailyStats(params: SyncCampaignParams): Promise<SyncCampaignDailyStatsResult> {
  const { clientId, metaCampaignId, campaignNumber, leadActionType = '' } = params
  const supabase = createAdminClient()

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('client_id', clientId)
    .eq('campaign_number', campaignNumber)
    .maybeSingle()

  if (campaignError) {
    throw new Error(`Échec lecture campagne n°${campaignNumber} : ${campaignError.message}`)
  }
  if (!campaign) {
    throw new Error(
      `Campagne n°${campaignNumber} introuvable en base : synchroniser d'abord via syncCampaign()/syncAllCampaigns().`
    )
  }

  const adSets = await fetchCampaignAdSets(metaCampaignId)
  const group = groupByCampaignNumber(adSets, campaignNumber)

  if (!group.barbier || !group.coiffeur) {
    throw new Error(
      `Regroupement invalide pour la campagne n°${campaignNumber} : audience barbier ou coiffeur introuvable.`
    )
  }

  // Séquentiel (pas Promise.all) : voir note d'en-tête.
  const barbierDaily = await fetchAdSetDailyInsights(group.barbier.id)
  const coiffeurDaily = await fetchAdSetDailyInsights(group.coiffeur.id)

  const aggregated = aggregateDailyInsights(barbierDaily, coiffeurDaily, leadActionType)

  if (aggregated.length === 0) {
    return { campaignNumber, campaignId: campaign.id, daysUpserted: 0, dates: [] }
  }

  const rows = aggregated.map((day) => ({
    client_id: clientId,
    campaign_id: campaign.id,
    stat_date: day.statDate,
    meta_spend: day.metaSpend,
    meta_pixel_leads: day.metaPixelLeads,
    // calendly_appointments volontairement absent : ni écrit à la création
    // (défaut 0 en base), ni écrasé lors d'un upsert ultérieur.
  }))

  const { error: upsertError } = await supabase
    .from('campaign_daily_stats')
    .upsert(rows, { onConflict: 'campaign_id,stat_date' })

  if (upsertError) {
    throw new Error(`Échec upsert campaign_daily_stats campagne n°${campaignNumber} : ${upsertError.message}`)
  }

  return {
    campaignNumber,
    campaignId: campaign.id,
    daysUpserted: rows.length,
    dates: aggregated.map((day) => day.statDate),
  }
}
