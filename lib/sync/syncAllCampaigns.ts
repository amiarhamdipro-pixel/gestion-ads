// Synchronise UNE SEULE campagne dynamique par appel — règle métier
// officielle (voir BRIEF-CLAUDE-CODE.md) : Synchroniser ne traite jamais
// plusieurs campagnes à la fois. Réutilise discoverCampaignNumbers() et
// syncCampaign() tels quels — aucune logique de fetch/regroupement/upsert
// dupliquée ici. Les groupes invalides ne sont jamais tentés, donc jamais
// journalisés dans sync_runs (syncCampaign est seul responsable de cette
// journalisation, par campagne réellement synchronisée).
//
// Campagnes sync_locked=true (campaigns.sync_locked — référence historique
// figée OU campagne publiée, donc verrouillée définitivement) : exclues
// AVANT tout appel Meta, pas seulement protégées en écriture — économise
// aussi les appels API. Parmi les candidates restantes, seule celle au
// campaign_number le plus petit est synchronisée (selectSequentialTarget
// ci-dessous) ; les autres restent "en attente" (waiting), strictement
// inchangées ce passage — jamais de seuil numérique codé en dur (ex.
// campaign_number >= 20) : la sélection dérive entièrement de sync_locked.

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

export type SequentialTargetSelection = {
  skippedLocked: number[]
  targetCampaignNumber: number | null
  waiting: number[]
}

// Sélection séquentielle partagée par syncAllCampaigns (Meta totaux) et
// syncAllCampaignsDailyStats (Meta quotidien) — garantit qu'un même appel
// "Synchroniser" cible toujours la même campagne pour les deux volets Meta.
// validNumbers : campagnes valides détectées côté Meta (discoverCampaignNumbers).
export function selectSequentialTarget(validNumbers: number[], locked: Set<number>): SequentialTargetSelection {
  const skippedLocked = validNumbers.filter((n) => locked.has(n))
  const candidates = validNumbers.filter((n) => !locked.has(n)).sort((a, b) => a - b)
  return {
    skippedLocked,
    targetCampaignNumber: candidates[0] ?? null,
    waiting: candidates.slice(1),
  }
}

export async function syncAllCampaigns(params: SyncAllCampaignsParams): Promise<SyncAllCampaignsReport> {
  const { clientId, metaCampaignId, leadActionType } = params

  const discovery = await discoverCampaignNumbers(metaCampaignId)
  const locked = await getLockedCampaignNumbers(clientId)
  const { skippedLocked, targetCampaignNumber, waiting } = selectSequentialTarget(discovery.valid, locked)

  const details: CampaignSyncOutcome[] = []

  if (targetCampaignNumber !== null) {
    try {
      const result = await syncCampaign({ clientId, metaCampaignId, campaignNumber: targetCampaignNumber, leadActionType })
      details.push({ campaignNumber: targetCampaignNumber, status: 'success', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      details.push({ campaignNumber: targetCampaignNumber, status: 'failed', message })
    }
  }

  return {
    totalDetected: discovery.valid.length,
    targetCampaignNumber,
    succeeded: details.filter((detail) => detail.status === 'success').length,
    failed: details.filter((detail) => detail.status === 'failed').length,
    skippedLocked,
    waiting,
    invalid: discovery.invalid,
    details,
  }
}
