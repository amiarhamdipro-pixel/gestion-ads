// Transformation pure : réponses Meta brutes -> lignes Insert des tables
// audiences/videos (types/database.ts). Aucun appel réseau ni base ici.

import type { Database } from '@/types/database'
import { classifyAudienceType } from './groupByCampaign'
import type {
  MetaAction,
  MetaAd,
  MetaAdInsights,
  MetaAdSet,
  MetaAdSetAgeInsight,
  MetaAdSetDailyInsight,
  MetaAdSetInsights,
  MetaActionValue,
} from './types'

type AudienceInsert = Database['public']['Tables']['audiences']['Insert']
type VideoInsert = Database['public']['Tables']['videos']['Insert']
type AppointmentBreakdownInsert = Database['public']['Tables']['appointment_breakdowns']['Insert']

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

// Seul object_story_spec.video_data.video_id est utilisé (jamais
// creative.video_id, racine — voir MetaAdCreative, types.ts). Retourne null
// pour toute pub non vidéo (creative/object_story_spec/video_data absent) :
// aucun appel Meta n'est alors tenté pour cette pub (lib/sync/syncCampaign.ts).
export function extractVideoId(ad: MetaAd): string | null {
  return ad.creative?.object_story_spec?.video_data?.video_id ?? null
}

// Correctifs manuels ponctuels de titre vidéo Meta — JAMAIS une règle
// générique (regex/normalize) qui risquerait d'altérer le titre légitime
// d'une autre vidéo. Diagnostic réel (campagne n°20, audience Barbier,
// 2026-08) : GET /{video_id}?fields=title renvoie littéralement
// "video 3 - vide╠üo ciseaux .mp4" (caractères U+2560/U+00FC
// intercalés + espace parasite avant .mp4) — vérifié en inspectant les
// octets bruts de la réponse Meta elle-même, donc une corruption réelle et
// permanente côté Meta (probablement à l'upload du fichier), PAS un bug de
// décodage dans ce pipeline (JSON est toujours UTF-8, aucune réencodage
// n'intervient ici) : normalize('NFC'/'NFD') ne change rien, confirmé.
// Corrigé au cas par cas, par video_id exact, même principe que
// MANUAL_OVERRIDES (scripts/import-historical-excel.ts) : n'ajouter une
// entrée qu'après confirmation explicite du nom réel du fichier.
const KNOWN_VIDEO_TITLE_CORRECTIONS: Record<string, string> = {
  // Campagne n°20, audience Barbier — nom réel confirmé par le client.
  '1281121464129222': 'video 3 - video ciseaux.mp4',
}

export function applyKnownVideoTitleCorrection(videoId: string, title: string | null): string | null {
  return KNOWN_VIDEO_TITLE_CORRECTIONS[videoId] ?? title
}

export function mapAdToVideoInsert(
  audienceId: string,
  ad: MetaAd,
  insights: MetaAdInsights | null,
  videoDisplayName: string | null
): VideoInsert {
  return {
    audience_id: audienceId,
    meta_ad_id: ad.id,
    name: ad.name,
    video_display_name: videoDisplayName,
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

// Colonnes réellement présentes dans appointment_breakdowns (schéma initial,
// inchangé). age_55_plus regroupe les deux dernières tranches Meta (55-64 et
// 65+) : le schéma n'a qu'un seul palier "55 et +", jamais scindé. Toute
// valeur d'âge Meta absente de cette table (observé : "Unknown", leads dont
// Meta ne peut pas déterminer l'âge) est délibérément ignorée — aucune
// colonne ne peut l'accueillir sans répartition arbitraire sur les tranches
// connues, donc jamais comptée nulle part (voir mapAgeInsightsToBreakdownInsert).
const AGE_BUCKET_COLUMNS: Record<string, 'age_18_24' | 'age_25_34' | 'age_35_44' | 'age_45_54' | 'age_55_plus'> = {
  '18-24': 'age_18_24',
  '25-34': 'age_25_34',
  '35-44': 'age_35_44',
  '45-54': 'age_45_54',
  '55-64': 'age_55_plus',
  '65+': 'age_55_plus',
}

// Agrège les deux ad sets (barbier + coiffeur, même principe que
// aggregateDailyInsights ci-dessus) : appointment_breakdowns est une table
// au niveau campagne (une ligne, clé unique campaign_id), pas par audience.
// instagram_count/facebook_count (mêmes colonnes, répartition RDV par
// plateforme) sont volontairement absents du retour : hors périmètre de
// cette fonction (répartition par tranche d'âge uniquement), leur défaut
// colonne (0) reste donc intact lors de l'upsert (voir types/database.ts).
export function mapAgeInsightsToBreakdownInsert(
  campaignId: string,
  insightsA: MetaAdSetAgeInsight[],
  insightsB: MetaAdSetAgeInsight[],
  leadActionType: string
): AppointmentBreakdownInsert {
  const totals = { age_18_24: 0, age_25_34: 0, age_35_44: 0, age_45_54: 0, age_55_plus: 0 }

  for (const row of [...insightsA, ...insightsB]) {
    const column = AGE_BUCKET_COLUMNS[row.age]
    if (!column) continue
    totals[column] += extractActionValue(row.actions, leadActionType)
  }

  return { campaign_id: campaignId, ...totals }
}
