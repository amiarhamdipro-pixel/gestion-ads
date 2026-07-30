// Formes brutes des réponses Meta Graph API consommées par la synchro.
// Internes à lib/sync : les types partagés avec le reste de l'app (AudienceType,
// lignes Insert des tables) restent dans types/database.ts et sont importés ici.

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
