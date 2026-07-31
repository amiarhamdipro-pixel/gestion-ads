// Synchronise tous les groupes de campagne valides détectés dans la campagne
// Meta maître. Réutilise discoverCampaignNumbers() et syncCampaign() tels
// quels — aucune logique de fetch/regroupement/upsert dupliquée ici. Chaque
// campagne valide est tentée séquentiellement (pas de Promise.all : un échec
// Meta isolé ne doit ni interrompre le lot ni se mélanger aux autres pour le
// diagnostic). Les groupes invalides ne sont jamais tentés, donc jamais
// journalisés dans sync_runs (syncCampaign est seul responsable de cette
// journalisation, par campagne réellement synchronisée).

import { discoverCampaignNumbers } from './discoverCampaigns'
import { syncCampaign } from './syncCampaign'
import type { CampaignSyncOutcome, SyncAllCampaignsParams, SyncAllCampaignsReport } from './types'

export async function syncAllCampaigns(params: SyncAllCampaignsParams): Promise<SyncAllCampaignsReport> {
  const { clientId, metaCampaignId, leadActionType } = params

  const discovery = await discoverCampaignNumbers(metaCampaignId)

  const details: CampaignSyncOutcome[] = []

  for (const campaignNumber of discovery.valid) {
    try {
      const result = await syncCampaign({ clientId, metaCampaignId, campaignNumber, leadActionType })
      details.push({ campaignNumber, status: 'success', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      details.push({ campaignNumber, status: 'failed', message })
    }
  }

  return {
    totalDetected: discovery.valid.length,
    succeeded: details.filter((detail) => detail.status === 'success').length,
    failed: details.filter((detail) => detail.status === 'failed').length,
    invalid: discovery.invalid,
    details,
  }
}
