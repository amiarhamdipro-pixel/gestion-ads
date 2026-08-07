// Formes brutes des réponses Meta Graph API consommées par la synchro, plus le
// contrat public de syncCampaign(). Les types partagés avec le reste de l'app
// (AudienceType, lignes Row/Insert des tables) restent dans types/database.ts
// et sont importés ici.

import type { Audience, Campaign, AppointmentBreakdown, Video } from '@/types/database'

export type MetaAction = {
  action_type: string
  value: string
}

export type MetaAdSet = {
  id: string
  name: string
  status: string
  start_time?: string
  end_time?: string
}

export type MetaAdSetInsights = {
  spend: string
  impressions?: string
  actions?: MetaAction[]
}

// Une ligne par jour (fields=date_start,date_stop,spend,actions,
// time_increment=1). date_start === date_stop pour un incrément d'un jour.
export type MetaAdSetDailyInsight = {
  date_start: string
  date_stop: string
  spend: string
  actions?: MetaAction[]
}

// Une ligne par tranche d'âge Meta (fields=spend,actions, breakdowns=age).
// Valeurs de `age` réellement observées (vérifié en conditions réelles sur
// la campagne n°20, voir lib/sync/mapper.ts, mapAgeInsightsToBreakdownInsert) :
// "18-24", "25-34", "35-44", "45-54", "55-64", "65+", et parfois "Unknown"
// (leads dont Meta ne peut pas déterminer l'âge — jamais de champ actions
// dans ce cas, donc jamais de lead compté dessus).
export type MetaAdSetAgeInsight = {
  age: string
  spend: string
  actions?: MetaAction[]
}

// object_story_spec.video_data.video_id est le SEUL video_id à utiliser
// (voir lib/sync/mapper.ts, extractVideoId) : creative.video_id (racine,
// absent ici volontairement) pointe vers un autre id Meta, inaccessible avec
// les permissions de ce token (erreur #10 "Application does not have
// permission for this action", constatée en conditions réelles sur les 2
// pubs de la campagne 20).
export type MetaAdCreative = {
  object_story_spec?: {
    video_data?: {
      video_id?: string
    }
  }
}

export type MetaAd = {
  id: string
  name: string
  creative?: MetaAdCreative
}

// Réponse du node Vidéo Meta (GET /{video_id}?fields=title) — jamais d'autre
// champ demandé ici (pas de source/permalink_url/thumbnail, voir
// BRIEF-CLAUDE-CODE.md).
export type MetaVideoTitle = {
  id: string
  title?: string
}

// POC miniature réelle (campagne n°20 uniquement, voir BRIEF-CLAUDE-CODE.md
// et lib/sync/meta.ts, fetchAdVideoId) : réponse minimale du node Pub (GET
// /{ad_id}?fields=creative{object_story_spec}) utilisée pour retrouver le
// video_id Meta d'une pub déjà connue (videos.meta_ad_id stocké en base),
// même chemin d'extraction que MetaAd/extractVideoId (lib/sync/mapper.ts)
// mais sans les champs non demandés ici (name).
export type MetaAdVideoLookup = {
  id: string
  creative?: MetaAdCreative
}

// POC miniature réelle (campagne n°20 uniquement) : réponse du node Vidéo
// pour la miniature (GET /{video_id}?fields=picture,format{picture,width,
// height,filter}). Vérifié en conditions réelles sur les 2 vidéos de la
// campagne n°20 : `format` expose plusieurs résolutions dérivées de LA MÊME
// image que `picture` (même fichier de base, seul le paramètre de
// redimensionnement `stp=` change) — `picture` seul reste figé à une petite
// taille fixe (~160×160, aucun modificateur de taille `.width()/.height()`
// n'a d'effet observé sur ce node), donc toujours préféré via `format` pour
// une carte plus grande (voir lib/sync/meta.ts, fetchVideoThumbnail).
// `filter` observés : "130x130", "480x480", "720x720", "native" (résolution
// native de la vidéo, ex. 1080x1920 en portrait). URLs Meta CDN signées et
// TEMPORAIRES (paramètre `oe=` de l'URL, horodatage Unix hex — décodé en
// conditions réelles : expiration ≈ 5 jours après génération) — jamais
// stockées, voir app/dashboard/campaigns/[id]/page.tsx.
export type MetaVideoFormatEntry = {
  picture: string
  width?: number
  height?: number
  filter: string
}

export type MetaVideoPicture = {
  id: string
  picture?: string
  format?: MetaVideoFormatEntry[]
}

export type MetaActionValue = {
  value: string
}

export type MetaAdInsights = {
  impressions?: string
  // "3 sec video views" (dénominateur du Hook Rate Meta) n'est pas un champ
  // insights dédié — Meta le renvoie comme une action générique de type
  // "video_view" dans le tableau actions (déjà utilisé ailleurs, ex. leads
  // pixel). video_3_sec_watched_actions n'existe pas côté API (confirmé :
  // Meta renvoie l'erreur #100 "not valid for fields param").
  actions?: MetaAction[]
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
  // Confirmé (voir BRIEF section 5) : offsite_conversion.custom.4312192355693474
  leadActionType?: string
}

export type SyncCampaignResult = {
  campaign: Campaign
  audiences: Audience[]
  videos: Video[]
  appointmentBreakdown: AppointmentBreakdown
}

export type InvalidCampaignGroup = {
  campaignNumber: number
  reason: string
}

export type CampaignNumberDiscovery = {
  valid: number[]
  invalid: InvalidCampaignGroup[]
}

export type SyncAllCampaignsParams = {
  clientId: string
  metaCampaignId: string
  leadActionType?: string
}

export type CampaignSyncOutcome =
  | { campaignNumber: number; status: 'success'; result: SyncCampaignResult }
  | { campaignNumber: number; status: 'failed'; message: string }

export type SyncAllCampaignsReport = {
  totalDetected: number
  // Sélection séquentielle (règle métier officielle, voir
  // BRIEF-CLAUDE-CODE.md et lib/sync/syncAllCampaigns.ts,
  // selectSequentialTarget) : au plus UNE campagne synchronisée par appel —
  // celle au campaign_number le plus petit parmi les candidates non
  // verrouillées. null si aucune candidate (toutes verrouillées ou aucune
  // campagne valide détectée).
  targetCampaignNumber: number | null
  succeeded: number
  failed: number
  // Campagnes sync_locked=true détectées côté Meta mais jamais tentées
  // (référence historique figée OU publiée) — voir campaigns.sync_locked.
  skippedLocked: number[]
  // Campagnes valides, non verrouillées, mais PAS la cible ce passage —
  // strictement inchangées (voir lib/sync/syncAppointments.ts,
  // syncCalendlyDailyStats.ts : gelées comme les campagnes verrouillées).
  waiting: number[]
  invalid: InvalidCampaignGroup[]
  details: CampaignSyncOutcome[]
}

// ─── Synchro quotidienne (campaign_daily_stats) ─────────────────────────────
// Réutilise SyncCampaignParams (même params : clientId, metaCampaignId,
// campaignNumber, leadActionType) — aucun type dupliqué.

export type SyncCampaignDailyStatsResult = {
  campaignNumber: number
  campaignId: string
  daysUpserted: number
  dates: string[]
}

export type CampaignDailyStatsSyncOutcome =
  | { campaignNumber: number; status: 'success'; result: SyncCampaignDailyStatsResult }
  | { campaignNumber: number; status: 'failed'; message: string }

export type SyncAllCampaignsDailyStatsReport = {
  totalDetected: number
  // Même sélection séquentielle que SyncAllCampaignsReport ci-dessus,
  // recalculée indépendamment (même règle, mêmes entrées — les deux
  // convergent forcément vers la même campagne au sein d'un même appel).
  targetCampaignNumber: number | null
  succeeded: number
  failed: number
  // true si l'arrêt anticipé a été déclenché par un code d'erreur Meta 17
  // (limite de débit) : les campagnes non tentées ne sont pas des échecs.
  stoppedOnRateLimit: boolean
  // Campagnes sync_locked=true détectées côté Meta mais jamais tentées
  // (référence historique figée OU publiée) — voir campaigns.sync_locked.
  skippedLocked: number[]
  // Campagnes valides, non verrouillées, mais PAS la cible ce passage —
  // strictement inchangées.
  waiting: number[]
  invalid: InvalidCampaignGroup[]
  details: CampaignDailyStatsSyncOutcome[]
}
