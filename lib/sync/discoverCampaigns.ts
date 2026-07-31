// Détection des numéros de campagne dashboard disponibles dans la campagne
// Meta maître (lecture seule, aucune écriture). Réutilise fetchCampaignAdSets
// (lib/sync/meta.ts) et discoverCampaignNumbersFromAdSets (groupByCampaign.ts)
// sans dupliquer leur logique.

import { fetchCampaignAdSets } from './meta'
import { discoverCampaignNumbersFromAdSets } from './groupByCampaign'
import type { CampaignNumberDiscovery } from './types'

export async function discoverCampaignNumbers(metaCampaignId: string): Promise<CampaignNumberDiscovery> {
  const adSets = await fetchCampaignAdSets(metaCampaignId)
  return discoverCampaignNumbersFromAdSets(adSets)
}
