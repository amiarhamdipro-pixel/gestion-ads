// Regroupement des ad sets par numéro de campagne (règle métier du brief,
// section 2) : une campagne dashboard = les ad sets préfixés du même numéro,
// toujours 2 (Barbier + Coiffeur).

import type { AudienceType } from '@/types/database'
import type { CampaignNumberDiscovery, MetaAdSet } from './types'

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

// Numéro préfixe d'un ad set, même convention que filterAdSetsByCampaignNumber
// (nombre en tête du nom), mais extrait sans connaître le numéro à l'avance —
// nécessaire pour la découverte (ci-dessous), contrairement au filtre qui
// teste un numéro déjà connu.
function extractCampaignNumber(adSetName: string): number | null {
  const match = adSetName.match(/^\s*(\d+)\b/)
  return match ? Number(match[1]) : null
}

// Parcourt tous les ad sets de la campagne maître et regroupe par numéro
// détecté, en réutilisant classifyAudienceType (aucune duplication de la
// classification barbier/coiffeur). Un groupe n'est valide que s'il contient
// exactement 2 ad sets classés 1 barbier + 1 coiffeur ; sinon il est signalé
// comme invalide avec la raison, sans jamais interrompre la détection globale.
export function discoverCampaignNumbersFromAdSets(adSets: MetaAdSet[]): CampaignNumberDiscovery {
  const groupsByNumber = new Map<number, MetaAdSet[]>()

  for (const adSet of adSets) {
    const campaignNumber = extractCampaignNumber(adSet.name)
    if (campaignNumber === null) continue
    const group = groupsByNumber.get(campaignNumber) ?? []
    group.push(adSet)
    groupsByNumber.set(campaignNumber, group)
  }

  const valid: number[] = []
  const invalid: CampaignNumberDiscovery['invalid'] = []

  for (const [campaignNumber, group] of groupsByNumber) {
    if (group.length !== 2) {
      invalid.push({
        campaignNumber,
        reason: `${group.length} ad set(s) trouvé(s) (2 attendus : Barbier + Coiffeur).`,
      })
      continue
    }

    const barbierCount = group.filter((adSet) => classifyAudienceType(adSet.name) === 'barbier').length
    const coiffeurCount = group.filter((adSet) => classifyAudienceType(adSet.name) === 'coiffeur').length

    if (barbierCount !== 1 || coiffeurCount !== 1) {
      invalid.push({
        campaignNumber,
        reason: `Classification ambiguë : ${barbierCount} barbier(s), ${coiffeurCount} coiffeur(s) (1+1 attendu).`,
      })
      continue
    }

    valid.push(campaignNumber)
  }

  valid.sort((a, b) => a - b)
  invalid.sort((a, b) => a.campaignNumber - b.campaignNumber)

  return { valid, invalid }
}
