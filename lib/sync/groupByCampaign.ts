// Regroupement des ad sets par numéro de campagne (règle métier du brief,
// section 2) : une campagne dashboard = les ad sets préfixés du même numéro,
// toujours 2 (Barbier + Coiffeur).

import type { AudienceType } from '@/types/database'
import type { MetaAdSet } from './types'

export type CampaignAdSetGroup = {
  campaignNumber: number
  barbier: MetaAdSet | null
  coiffeur: MetaAdSet | null
}

export function filterAdSetsByCampaignNumber(adSets: MetaAdSet[], campaignNumber: number): MetaAdSet[] {
  const prefixPattern = new RegExp(`^\\s*${campaignNumber}\\b`)
  return adSets.filter((adSet) => prefixPattern.test(adSet.name))
}

export function classifyAudienceType(adSetName: string): AudienceType {
  return /coiffeur/i.test(adSetName) ? 'coiffeur' : 'barbier'
}

export function groupByCampaignNumber(adSets: MetaAdSet[], campaignNumber: number): CampaignAdSetGroup {
  const matched = filterAdSetsByCampaignNumber(adSets, campaignNumber)

  const group: CampaignAdSetGroup = { campaignNumber, barbier: null, coiffeur: null }

  for (const adSet of matched) {
    if (classifyAudienceType(adSet.name) === 'coiffeur') {
      group.coiffeur = adSet
    } else {
      group.barbier = adSet
    }
  }

  return group
}
