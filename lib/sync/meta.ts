// Appels Meta Graph API en lecture seule (aucun POST/DELETE). Reprend le même
// principe que meta-test.mjs (Phase 0) sous forme de fonctions typées et
// réutilisables. N'écrit rien en base : voir mapper.ts / groupByCampaign.ts.

import type {
  MetaAd,
  MetaAdInsights,
  MetaAdSet,
  MetaAdSetAgeInsight,
  MetaAdSetDailyInsight,
  MetaAdSetInsights,
  MetaVideoTitle,
} from './types'

type MetaApiErrorResponse = {
  error: { message: string; code: number }
}

type MetaListResponse<T> = {
  data: T[]
  paging?: { next?: string }
}

function isMetaApiError(value: unknown): value is MetaApiErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'object'
  )
}

function getMetaConfig() {
  const accessToken = process.env.META_ACCESS_TOKEN
  const apiVersion = process.env.META_API_VERSION

  if (!accessToken || !apiVersion) {
    throw new Error('Missing META_ACCESS_TOKEN or META_API_VERSION environment variable.')
  }

  return { accessToken, baseUrl: `https://graph.facebook.com/${apiVersion}` }
}

async function metaApiGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const { accessToken, baseUrl } = getMetaConfig()
  const url = new URL(`${baseUrl}/${path}`)
  url.searchParams.set('access_token', accessToken)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url)
  const json: unknown = await response.json()

  if (isMetaApiError(json)) {
    throw new Error(`Meta API — ${json.error.message} (code ${json.error.code})`)
  }

  return json as T
}

async function metaApiGetAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = []
  let page = await metaApiGet<MetaListResponse<T>>(path, params)
  out.push(...page.data)

  while (page.paging?.next) {
    const response = await fetch(page.paging.next)
    const json: unknown = await response.json()

    if (isMetaApiError(json)) {
      throw new Error(`Meta API — ${json.error.message} (code ${json.error.code})`)
    }

    page = json as MetaListResponse<T>
    out.push(...page.data)
  }

  return out
}

export async function fetchCampaignAdSets(metaCampaignId: string): Promise<MetaAdSet[]> {
  return metaApiGetAll<MetaAdSet>(`${metaCampaignId}/adsets`, {
    fields: 'id,name,status,start_time,end_time',
    limit: '200',
  })
}

export async function fetchAdSetInsights(
  adSetId: string,
  datePreset = 'maximum'
): Promise<MetaAdSetInsights | null> {
  const page = await metaApiGet<MetaListResponse<MetaAdSetInsights>>(`${adSetId}/insights`, {
    fields: 'spend,impressions,actions',
    date_preset: datePreset,
  })
  return page.data[0] ?? null
}

// Insights quotidiens (time_increment=1) : une ligne par jour réellement
// retourné par Meta, jamais un jour synthétique pour une date sans donnée
// (voir syncCampaignDailyStats.ts, qui n'insère que les dates reçues ici).
// Même pagination que les autres endpoints insights (metaApiGetAll).
export async function fetchAdSetDailyInsights(
  adSetId: string,
  datePreset = 'maximum'
): Promise<MetaAdSetDailyInsight[]> {
  return metaApiGetAll<MetaAdSetDailyInsight>(`${adSetId}/insights`, {
    fields: 'date_start,date_stop,spend,actions',
    time_increment: '1',
    date_preset: datePreset,
  })
}

// Répartition des leads par tranche d'âge (breakdowns=age), vérifiée en
// conditions réelles sur la campagne n°20 : une ligne par tranche d'âge
// Meta, avec actions incluant le lead pixel (LEAD_ACTION_TYPE) déjà utilisé
// ailleurs (fetchAdSetInsights). Même pagination que les autres endpoints
// insights (metaApiGetAll).
export async function fetchAdSetAgeInsights(
  adSetId: string,
  datePreset = 'maximum'
): Promise<MetaAdSetAgeInsight[]> {
  return metaApiGetAll<MetaAdSetAgeInsight>(`${adSetId}/insights`, {
    fields: 'spend,actions',
    breakdowns: 'age',
    date_preset: datePreset,
  })
}

export async function fetchAdSetAds(adSetId: string): Promise<MetaAd[]> {
  return metaApiGetAll<MetaAd>(`${adSetId}/ads`, {
    fields: 'id,name,creative{object_story_spec}',
    limit: '50',
  })
}

// Lecture seule, un seul champ (title) — jamais source/permalink_url/
// thumbnail (voir BRIEF-CLAUDE-CODE.md). Ne lève jamais : la synchro d'une
// campagne ne doit jamais échouer à cause du nom de fichier vidéo (pas de
// title, permission refusée sur ce video_id, pub non vidéo...) — tout échec
// se traduit par null, jamais une exception propagée à l'appelant
// (lib/sync/syncCampaign.ts, qui stocke alors video_display_name = null).
export async function fetchVideoTitle(videoId: string): Promise<string | null> {
  try {
    const video = await metaApiGet<MetaVideoTitle>(videoId, { fields: 'title' })
    return video.title ?? null
  } catch {
    return null
  }
}

export async function fetchAdInsights(adId: string, datePreset = 'maximum'): Promise<MetaAdInsights | null> {
  const fields = [
    'impressions',
    'actions',
    'video_play_actions',
    'video_thruplay_watched_actions',
    'video_avg_time_watched_actions',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p100_watched_actions',
  ].join(',')

  const page = await metaApiGet<MetaListResponse<MetaAdInsights>>(`${adId}/insights`, {
    fields,
    date_preset: datePreset,
  })
  return page.data[0] ?? null
}
