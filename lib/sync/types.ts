// Formes brutes des réponses Meta Graph API consommées par la synchro, plus le
// contrat public de syncCampaign(). Les types partagés avec le reste de l'app
// (AudienceType, lignes Row/Insert des tables) restent dans types/database.ts
// et sont importés ici.

import type { Audience, Campaign, Video } from '@/types/database'

export type MetaAction = {
  action_type: string
  value: string
}

export type MetaAdSet = {
  id: string
  name: string
  status: string
}

export type MetaAdSetInsights = {
  spend: string
  impressions?: string
  actions?: MetaAction[]
}

export type MetaAd = {
  id: string
  name: string
}

export type MetaActionValue = {
  value: string
}

export type MetaAdInsights = {
  impressions?: string
  video_play_actions?: MetaActionValue[]
  video_thruplay_watched_actions?: MetaActionValue[]
  video_avg_time_watched_actions?: MetaActionValue[]
  video_p25_watched_actions?: MetaActionValue[]
  video_p50_watched_actions?: MetaActionValue[]
  video_p75_watched_actions?: MetaActionValue[]
  video_p100_watched_actions?: MetaActionValue[]
}

export type SyncCampaignParams = {
  clientId: string
  metaCampaignId: string
  campaignNumber: number
  // Candidat non confirmé (voir BRIEF section 5) : offsite_conversion.custom.4312192355693474
  leadActionType?: string
}

export type SyncCampaignResult = {
  campaign: Campaign
  audiences: Audience[]
  videos: Video[]
}
