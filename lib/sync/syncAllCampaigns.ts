// Synchronise tous les groupes de campagne valides détectés dans la campagne
// Meta maître. Réutilise discoverCampaignNumbers() et syncCampaign() tels
// quels — aucune logique de fetch/regroupement/upsert dupliquée ici. Chaque
// campagne valide est tentée séquentiellement (pas de Promise.all : un échec
// Meta isolé ne doit ni interrompre le lot ni se mélanger aux autres pour le
// diagnostic). Les groupes invalides ne sont jamais tentés, donc jamais
// journalisés dans sync_runs (syncCampaign est seul responsable de cette
// journalisation, par campagne réellement synchronisée).
//
// Campagnes sync_locked=true (campaigns.sync_locked, référence historique
// figée) : exclues AVANT tout appel Meta, pas seulement protégées en
// écriture — économise aussi les appels API pour ces campagnes qui n'ont de
// toute façon plus vocation à changer. totalDetected/succeeded/failed ne
// portent que sur les campagnes réellement candidates (non verrouillées) ;
// skippedLocked liste séparément celles ignorées, à titre d'information.

import { createAdminClient } from '@/lib/supabase/admin'
import { discoverCampaignNumbers } from './discoverCampaigns'
import { syncCampaign } from './syncCampaign'
import type { CampaignSyncOutcome, SyncAllCampaignsParams, SyncAllCampaignsReport } from './types'

export async function getLockedCampaignNumbers(clientId: string): Promise<Set<number>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('campaign_number')
    .eq('client_id', clientId)
    .eq('sync_locked', true)

  if (error) {
    throw new Error(`Échec lecture des campagnes verrouillées : ${error.message}`)
  }

  return new Set((data ?? []).map((c) => c.campaign_number))
}

export async function syncAllCampaigns(params: SyncAllCampaignsParams): Promise<SyncAllCampaignsReport> {
  const { clientId, metaCampaignId, leadActionType } = params

  const discovery = await discoverCampaignNumbers(metaCampaignId)
  const locked = await getLockedCampaignNumbers(clientId)
  const skippedLocked = discovery.valid.filter((n) => locked.has(n))
  const toSync = discovery.valid.filter((n) => !locked.has(n))

  const details: CampaignSyncOutcome[] = []

  for (const campaignNumber of toSync) {
    try {
      const result = await syncCampaign({ clientId, metaCampaignId, campaignNumber, leadActionType })
      details.push({ campaignNumber, status: 'success', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      details.push({ campaignNumber, status: 'failed', message })
    }
  }

  return {
    totalDetected: toSync.length,
    succeeded: details.filter((detail) => detail.status === 'success').length,
    failed: details.filter((detail) => detail.status === 'failed').length,
    skippedLocked,
    invalid: discovery.invalid,
    details,
  }
}
