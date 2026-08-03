// Synchronise campaign_daily_stats pour tous les groupes de campagne valides
// détectés dans la campagne Meta maître. Miroir de syncAllCampaigns.ts :
// traitement strictement séquentiel (pas de Promise.all — un échec Meta
// isolé ne doit ni interrompre le lot ni se mélanger aux autres). Différence
// volontaire : un code d'erreur Meta 17 (limite de débit) arrête la boucle
// immédiatement plutôt que de continuer sur les campagnes restantes — un
// code 17 sur une campagne signifie presque certainement que les suivantes
// échoueraient aussi, mieux vaut s'arrêter net que multiplier les tentatives
// vouées à l'échec contre l'API Meta.
//
// Campagnes sync_locked=true : exclues avant tout appel Meta, comme dans
// syncAllCampaigns.ts (même helper getLockedCampaignNumbers) — une référence
// historique figée n'a plus de statistiques quotidiennes à recalculer.

import { discoverCampaignNumbers } from './discoverCampaigns'
import { getLockedCampaignNumbers } from './syncAllCampaigns'
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
  const skippedLocked = discovery.valid.filter((n) => locked.has(n))
  const toSync = discovery.valid.filter((n) => !locked.has(n))

  const details: CampaignDailyStatsSyncOutcome[] = []
  let stoppedOnRateLimit = false

  for (const campaignNumber of toSync) {
    try {
      const result = await syncCampaignDailyStats({ clientId, metaCampaignId, campaignNumber, leadActionType })
      details.push({ campaignNumber, status: 'success', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      details.push({ campaignNumber, status: 'failed', message })

      if (isMetaRateLimitError(error)) {
        stoppedOnRateLimit = true
        break
      }
    }
  }

  return {
    totalDetected: toSync.length,
    succeeded: details.filter((detail) => detail.status === 'success').length,
    failed: details.filter((detail) => detail.status === 'failed').length,
    stoppedOnRateLimit,
    skippedLocked,
    invalid: discovery.invalid,
    details,
  }
}
