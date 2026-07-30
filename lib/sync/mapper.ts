// Transformation pure : réponses Meta brutes -> lignes Insert des tables
// audiences/videos (types/database.ts). Aucun appel réseau ni base ici.

import type { Database } from '@/types/database'
import { classifyAudienceType } from './groupByCampaign'
import type { MetaAction, MetaAd, MetaAdInsights, MetaAdSet, MetaAdSetInsights, MetaActionValue } from './types'

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

export function mapAdToVideoInsert(audienceId: string, ad: MetaAd, insights: MetaAdInsights | null): VideoInsert {
  return {
    audience_id: audienceId,
    meta_ad_id: ad.id,
    name: ad.name,
    impressions: insights ? Number(insights.impressions ?? 0) : 0,
    video_plays: firstActionValue(insights?.video_play_actions),
    thruplays: firstActionValue(insights?.video_thruplay_watched_actions),
    average_watch_time_seconds: firstActionValue(insights?.video_avg_time_watched_actions),
    video_p25: firstActionValue(insights?.video_p25_watched_actions),
    video_p50: firstActionValue(insights?.video_p50_watched_actions),
    video_p75: firstActionValue(insights?.video_p75_watched_actions),
    video_p100: firstActionValue(insights?.video_p100_watched_actions),
  }
}
