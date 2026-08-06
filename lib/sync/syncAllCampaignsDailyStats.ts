// Synchronise campaign_daily_stats pour UNE SEULE campagne dynamique par
// appel — même sélection séquentielle que syncAllCampaigns.ts
// (selectSequentialTarget, réutilisée telle quelle : les deux volets Meta
// ciblent donc toujours la même campagne au sein d'un même clic
// "Synchroniser"). Un code d'erreur Meta 17 (limite de débit) sur l'unique
// tentative est signalé via stoppedOnRateLimit, à titre d'information pour
// le rapport (il n'y a plus de campagnes suivantes à ne pas tenter).
//
// Campagnes sync_locked=true : exclues avant tout appel Meta, comme dans
// syncAllCampaigns.ts (même helper getLockedCampaignNumbers) — une campagne
// verrouillée (historique figée ou publiée) n'a plus de statistiques
// quotidiennes à recalculer.

import { discoverCampaignNumbers } from './discoverCampaigns'
import { getLockedCampaignNumbers, selectSequentialTarget } from './syncAllCampaigns'
import { syncCampaignDailyStats } from './syncCampaignDailyStats'
import type { CampaignDailyStatsSyncOutcome, SyncAllCampaignsDailyStatsReport, SyncAllCampaignsParams } from './types'

function isMetaRateLimitError(error: unknown): boolean {
  return error instanceof Error && /\(code 17\)/.test(error.message)
}

export async function syncAllCampaignsDailyStats(
  params: SyncAllCampaignsParams
): Promise<SyncAllCampaignsDailyStatsReport> {
  const { clientId, metaCampaignId, leadActionType } = params

  const discovery = await discoverCampaignNumbers(metaCampaignId)
  const locked = await getLockedCampaignNumbers(clientId)
  const { skippedLocked, targetCampaignNumber, waiting } = selectSequentialTarget(discovery.valid, locked)

  const details: CampaignDailyStatsSyncOutcome[] = []
  let stoppedOnRateLimit = false

  if (targetCampaignNumber !== null) {
    try {
      const result = await syncCampaignDailyStats({ clientId, metaCampaignId, campaignNumber: targetCampaignNumber, leadActionType })
      details.push({ campaignNumber: targetCampaignNumber, status: 'success', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      details.push({ campaignNumber: targetCampaignNumber, status: 'failed', message })

      if (isMetaRateLimitError(error)) {
        stoppedOnRateLimit = true
      }
    }
  }

  return {
    totalDetected: discovery.valid.length,
    targetCampaignNumber,
    succeeded: details.filter((detail) => detail.status === 'success').length,
    failed: details.filter((detail) => detail.status === 'failed').length,
    stoppedOnRateLimit,
    skippedLocked,
    waiting,
    invalid: discovery.invalid,
    details,
  }
}
