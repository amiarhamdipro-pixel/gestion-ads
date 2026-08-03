// Transformation pure : réponses Meta brutes -> lignes Insert des tables
// audiences/videos (types/database.ts). Aucun appel réseau ni base ici.

import type { Database } from '@/types/database'
import { classifyAudienceType } from './groupByCampaign'
import type {
  MetaAction,
  MetaAd,
  MetaAdInsights,
  MetaAdSet,
  MetaAdSetDailyInsight,
  MetaAdSetInsights,
  MetaActionValue,
} from './types'

type AudienceInsert = Database['public']['Tables']['audiences']['Insert']
type VideoInsert = Database['public']['Tables']['videos']['Insert']

export function extractActionValue(actions: MetaAction[] | undefined, actionType: string): number {
  const match = actions?.find((action) => action.action_type === actionType)
  return match ? Number(match.value) : 0
}

function firstActionValue(values: MetaActionValue[] | undefined): number {
  return values?.[0] ? Number(values[0].value) : 0
}

export function mapAdSetToAudienceInsert(
  campaignId: string,
  adSet: MetaAdSet,
  insights: MetaAdSetInsights | null,
  leadActionType: string
): AudienceInsert {
  return {
    campaign_id: campaignId,
    meta_adset_id: adSet.id,
    audience_type: classifyAudienceType(adSet.name),
    name: adSet.name,
    meta_spend: insights ? Number(insights.spend) : 0,
    meta_pixel_leads: insights ? extractActionValue(insights.actions, leadActionType) : 0,
  }
}

export type AggregatedDailyStat = { statDate: string; metaSpend: number; metaPixelLeads: number }

// Agrège deux séries d'insights quotidiens (barbier + coiffeur) au niveau
// campagne + date : additionne spend/leads des deux audiences pour chaque
// date_start rencontrée. Une date absente des deux séries n'apparaît jamais
// ici (aucun jour synthétique) ; une date présente dans une seule série est
// tout de même agrégée (l'autre audience compte pour 0 ce jour-là — donnée
// réelle, pas une valeur inventée). Réutilise extractActionValue ci-dessus,
// aucune logique d'extraction dupliquée.
export function aggregateDailyInsights(
  insightsA: MetaAdSetDailyInsight[],
  insightsB: MetaAdSetDailyInsight[],
  leadActionType: string
): AggregatedDailyStat[] {
  const byDate = new Map<string, { spend: number; leads: number }>()

  for (const day of [...insightsA, ...insightsB]) {
    const existing = byDate.get(day.date_start) ?? { spend: 0, leads: 0 }
    existing.spend += Number(day.spend)
    existing.leads += extractActionValue(day.actions, leadActionType)
    byDate.set(day.date_start, existing)
  }

  return Array.from(byDate.entries())
    .map(([statDate, { spend, leads }]) => ({ statDate, metaSpend: spend, metaPixelLeads: leads }))
    .sort((a, b) => (a.statDate < b.statDate ? -1 : a.statDate > b.statDate ? 1 : 0))
}

export function mapAdToVideoInsert(audienceId: string, ad: MetaAd, insights: MetaAdInsights | null): VideoInsert {
  return {
    audience_id: audienceId,
    meta_ad_id: ad.id,
    name: ad.name,
    impressions: insights ? Number(insights.impressions ?? 0) : 0,
    video_plays: firstActionValue(insights?.video_play_actions),
    // Vues 3 secondes : dénominateur du taux d'accroche ("Hook Rate") tel que
    // Meta le calcule lui-même (vues 3s ÷ impressions) — distinct de
    // video_plays ci-dessus (video_play_actions, un décompte de lectures non
    // filtré à 3s) qui ne reproduit pas les valeurs affichées par Meta.
    // Pas un champ insights dédié : Meta le renvoie dans actions, action_type
    // "video_view" (video_3_sec_watched_actions n'existe pas côté API — erreur
    // #100 confirmée en conditions réelles).
    video_plays_3s: extractActionValue(insights?.actions, 'video_view'),
    thruplays: firstActionValue(insights?.video_thruplay_watched_actions),
    average_watch_time_seconds: firstActionValue(insights?.video_avg_time_watched_actions),
    video_p25: firstActionValue(insights?.video_p25_watched_actions),
    video_p50: firstActionValue(insights?.video_p50_watched_actions),
    video_p75: firstActionValue(insights?.video_p75_watched_actions),
    video_p100: firstActionValue(insights?.video_p100_watched_actions),
  }
}
