// Classement vidéos : déduplication par IDENTITÉ RÉELLE de la créative, pas
// par meta_ad_id. Cause des doublons observés avant cette correction :
// l'import historique Excel (scripts/import-historical-excel.ts) attribue à
// chaque vidéo un meta_ad_id SYNTHÉTIQUE de la forme
// "excel-import:campaign-{N}:{audienceType}:video", unique par
// campagne+audience — deux occurrences de la MÊME créative (ex. "video 3 -
// video ciseaux.mp4", réutilisée sur les campagnes 3, 11 et 15) recevaient
// donc trois meta_ad_id distincts et apparaissaient comme trois vidéos
// différentes dans le classement au lieu d'une seule agrégée.
//
// Clé d'identité retenue (voir BRIEF-CLAUDE-CODE.md) : video_display_name
// s'il est renseigné, sinon videos.name — normalisée UNIQUEMENT pour la
// comparaison (voir videoIdentityKey), jamais pour l'affichage : le nom
// affiché est un nom réel issu des données (extension .mp4 incluse), le même
// pour toutes les vues (voir canonicalDisplayNames). Deux vidéos dont les
// noms diffèrent réellement, même proches, restent deux lignes distinctes.
//
// Dépenses/leads : ce sont ceux de l'AUDIENCE (audiences.meta_spend /
// meta_pixel_leads — aucune donnée par vidéo en base). Règle métier : 1 vidéo
// par audience. Chaque audience n'est donc comptée qu'UNE fois par vidéo
// regroupée (jamais une fois par ligne vidéo), et une audience portant
// plusieurs vidéos distinctes ne peut être attribuée à aucune d'elles : le
// coût/lead des vidéos concernées est marqué non comparable.
//
// Filtre Toutes / Barbier / Coiffeur : appliqué aux occurrences AVANT le
// regroupement (les trois vues sont calculées ici, une seule lecture base).
//
// Module pur (aucune lecture base), séparé de page.tsx pour être testable :
// scripts/test-video-identity.ts.

import { costPerMetaPixelLead } from '@/lib/calculations'
import type { RankedVideo, RankedVideosByAudience, VideoOccurrenceView } from './VideoRanking'

// Clé de regroupement d'un nom de vidéo. Absorbe UNIQUEMENT des variations
// de mise en forme, observées dans les noms Meta d'une même créative
// (ex. "video 5- yonn cut itw.mp4" / "vidéo 5- yonn cut itw .mp4") :
//   - casse ;
//   - accents (décomposition Unicode NFD, marques diacritiques retirées) ;
//   - espaces multiples ou en bordure ;
//   - espaces autour de la ponctuation (- _ . , ; : ' ( )) ;
//   - variantes typographiques d'apostrophe et de tiret ;
//   - accent aigu combinant corrompu "╠ü" (U+2560 U+00FC) observé dans des
//     noms Meta (ex. "vide╠üo") : octets UTF-8 CC 81 de U+0301 relus en
//     CP437. Rétabli en U+0301, puis retiré comme tout accent ci-dessous.
// Ne retire jamais un caractère alphanumérique ni une ponctuation : "video 1.2"
// et "video 12", "video 3" et "video 13" restent distinctes.
export function videoIdentityKey(name: string): string {
  return name
    .replace(/\u2560\u00fc/g, '\u0301')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/ ?([-_.,;:'()]) ?/g, '$1')
    .trim()
}

// Nom affiché d'un groupe : la variante réelle la plus fréquente parmi TOUTES
// les occurrences (avant filtre Barbier/Coiffeur, donc identique dans les
// trois vues), départage alphabétique pour rester déterministe — jamais
// dépendant de l'ordre de lecture base.
function canonicalDisplayNames(occurrences: { identityKey: string; displayName: string }[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const { identityKey, displayName } of occurrences) {
    const variants = counts.get(identityKey) ?? new Map<string, number>()
    variants.set(displayName, (variants.get(displayName) ?? 0) + 1)
    counts.set(identityKey, variants)
  }
  const canonical = new Map<string, string>()
  for (const [key, variants] of counts) {
    const [best] = Array.from(variants.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    canonical.set(key, best[0])
  }
  return canonical
}

export type RankingAudienceRow = {
  id: string
  campaign_id: string
  audience_type: 'barbier' | 'coiffeur'
  meta_spend: number
  meta_pixel_leads: number
}

export type RankingVideoRow = {
  audience_id: string
  name: string
  video_display_name: string | null
  video_plays: number
  video_plays_3s: number | null
  video_p100: number | null
  hook_rate_pct: number | null
  retention_rate_pct: number | null
}

type VideoOccurrence = {
  video: RankingVideoRow
  audience: RankingAudienceRow
  campaign: { campaign_number: number; sync_locked: boolean } | undefined
  identityKey: string
  displayName: string
}

// Détail campagne par campagne d'une vidéo regroupée : une ligne par
// AUDIENCE (campagne + Barbier/Coiffeur), calculée par rankOccurrences
// elle-même sur les seules occurrences de cette audience — mêmes règles que
// le classement (audience comptée une fois, audience partagée non
// comparable, accroche sans plays_3s exclue). Une même vidéo présente deux
// fois dans une audience reste donc une seule ligne, sans double comptage.
function occurrenceViews(occurrences: VideoOccurrence[], sharedAudienceIds: Set<string>): VideoOccurrenceView[] {
  const byAudience = new Map<string, VideoOccurrence[]>()
  for (const o of occurrences) {
    byAudience.set(o.audience.id, [...(byAudience.get(o.audience.id) ?? []), o])
  }
  return Array.from(byAudience.entries())
    .map(([audienceId, list]) => {
      const [stats] = rankOccurrences(list, sharedAudienceIds, false)
      return {
        key: audienceId,
        campaignNumber: list[0].campaign?.campaign_number ?? null,
        audienceType: list[0].audience.audience_type,
        totalLeads: stats.totalLeads,
        costPerLead: stats.costPerLead,
        cplNote: stats.cplNote,
        hookPlay: stats.hookPlay,
        retentionRate: stats.retentionRate,
      }
    })
    .sort(
      (a, b) =>
        (a.campaignNumber ?? Number.MAX_SAFE_INTEGER) - (b.campaignNumber ?? Number.MAX_SAFE_INTEGER) ||
        a.audienceType.localeCompare(b.audienceType)
    )
}

function rankOccurrences(occurrences: VideoOccurrence[], sharedAudienceIds: Set<string>, withDetail = true): RankedVideo[] {
  type VideoGroup = {
    displayName: string
    // Occurrences brutes du groupe (déjà filtrées par audience en amont),
    // pour le détail dépliable.
    occurrences: VideoOccurrence[]
    audienceTypes: Set<'barbier' | 'coiffeur'>
    campaignNumbers: Set<number>
    // Audiences déjà comptées pour ce groupe : chacune une seule fois.
    countedAudienceIds: Set<string>
    totalSpend: number
    totalLeads: number
    // Au moins une occurrence vient d'une audience à plusieurs vidéos :
    // dépenses/leads non attribuables -> coût/lead non comparable.
    touchesSharedAudience: boolean
    // Accroche et rétention agrégées indépendamment l'une de l'autre (une
    // occurrence peut avoir l'une en pct Excel et l'autre en compteurs bruts
    // — même règle de priorité par champ que campaigns/[id]/page.tsx :
    // sync_locked + pct non nul -> le pct Excel gouverne CETTE occurrence
    // pour CE champ ; sinon -> ses compteurs bruts contribuent aux sommes
    // "raw" ci-dessous. Formule finale unique (voir finalizeRate) : jamais
    // de moyenne simple, jamais de source silencieusement privilégiée.
    // rawHookPlays (dénominateur Meta, video_plays) — PAS impressions, voir
    // finalizeHookRate ci-dessous (même règle que
    // lib/calculations.ts, hookRateByPlays).
    rawHookPlays: number
    rawHookPlays3s: number
    excelHookWeightedSum: number
    excelHookWeight: number
    rawRetentionPlays3s: number
    rawRetentionP100: number
    excelRetentionWeightedSum: number
    excelRetentionWeight: number
  }

  const groups = new Map<string, VideoGroup>()
  for (const occurrence of occurrences) {
    const { video, audience, campaign, identityKey, displayName } = occurrence
    let group = groups.get(identityKey)
    if (!group) {
      group = {
        displayName,
        occurrences: [],
        audienceTypes: new Set(),
        campaignNumbers: new Set<number>(),
        countedAudienceIds: new Set<string>(),
        totalSpend: 0,
        totalLeads: 0,
        touchesSharedAudience: false,
        rawHookPlays: 0,
        rawHookPlays3s: 0,
        excelHookWeightedSum: 0,
        excelHookWeight: 0,
        rawRetentionPlays3s: 0,
        rawRetentionP100: 0,
        excelRetentionWeightedSum: 0,
        excelRetentionWeight: 0,
      }
      groups.set(identityKey, group)
    }

    group.occurrences.push(occurrence)
    group.audienceTypes.add(audience.audience_type)
    if (campaign) group.campaignNumbers.add(campaign.campaign_number)

    if (sharedAudienceIds.has(audience.id)) {
      group.touchesSharedAudience = true
    } else if (!group.countedAudienceIds.has(audience.id)) {
      group.countedAudienceIds.add(audience.id)
      group.totalSpend += audience.meta_spend
      group.totalLeads += audience.meta_pixel_leads
    }

    const hookFromExcel = Boolean(campaign?.sync_locked) && video.hook_rate_pct != null
    if (hookFromExcel) {
      // Pondération par les vues (video_plays, toujours renseigné — voir
      // types/database.ts) : le volume le plus pertinent réellement
      // disponible pour une occurrence Excel, qui n'a pas de compteurs bruts
      // impressions/video_plays_3s. Jamais une moyenne simple non pondérée.
      group.excelHookWeightedSum += (video.hook_rate_pct as number) * video.video_plays
      group.excelHookWeight += video.video_plays
    } else if (video.video_plays_3s != null) {
      // video_plays_3s null (vidéo historique jamais synchronisée, sans pct
      // Excel non plus) : occurrence exclue du numérateur ET du
      // dénominateur — ses vues ne doivent pas abaisser l'accroche du groupe.
      group.rawHookPlays += video.video_plays
      group.rawHookPlays3s += video.video_plays_3s
    }

    const retentionFromExcel = Boolean(campaign?.sync_locked) && video.retention_rate_pct != null
    if (retentionFromExcel) {
      group.excelRetentionWeightedSum += (video.retention_rate_pct as number) * video.video_plays
      group.excelRetentionWeight += video.video_plays
    } else {
      group.rawRetentionPlays3s += video.video_plays_3s ?? 0
      group.rawRetentionP100 += video.video_p100 ?? 0
    }
  }

  // Formule unique pour l'accroche, qu'une occurrence du groupe soit
  // dynamique (compteurs Meta bruts), historique (pct Excel) ou un mélange
  // des deux — même règle que app/dashboard/campaigns/[id]/page.tsx
  // (hookRateByPlays, lib/calculations.ts) : numérateur = Σ(video_plays_3s
  // bruts) + Σ(hook_rate_pct_excel × video_plays_excel) ; dénominateur =
  // Σ(video_plays bruts) + Σ(video_plays_excel) — JAMAIS impressions
  // (ancienne formule, abandonnée : ne reproduisait pas les taux Meta réels,
  // voir lib/calculations.ts, commentaire de hookRate). Cette formule se
  // réduit exactement à hookRateByPlays(Σplays3s, Σplays) quand toutes les
  // occurrences sont dynamiques (aucun terme Excel), et à la moyenne
  // pondérée par les vues quand toutes sont historiques (aucun terme brut) :
  // une seule règle documentée, jamais de source privilégiée silencieusement
  // en cas de mélange.
  function finalizeHookRate(g: VideoGroup): number | null {
    const numerator = g.rawHookPlays3s + g.excelHookWeightedSum
    const denominator = g.rawHookPlays + g.excelHookWeight
    return denominator > 0 ? numerator / denominator : null
  }

  // Même principe pour la rétention (formule Meta : video_p100 ÷
  // video_plays_3s, voir lib/calculations.ts retentionRate) : numérateur =
  // Σ(video_p100 bruts) + Σ(retention_rate_pct_excel × video_plays_excel) ;
  // dénominateur = Σ(video_plays_3s bruts) + Σ(video_plays_excel).
  function finalizeRetentionRate(g: VideoGroup): number | null {
    const numerator = g.rawRetentionP100 + g.excelRetentionWeightedSum
    const denominator = g.rawRetentionPlays3s + g.excelRetentionWeight
    return denominator > 0 ? numerator / denominator : null
  }

  // Coût/lead : jamais une moyenne des coûts/lead individuels, toujours le
  // ratio des totaux cumulés (Σdépenses ÷ Σleads, audiences comptées une
  // fois). Indisponible (null, jamais 0 €, jamais classé meilleur) si
  // l'audience est partagée, si aucun lead, ou si aucune dépense n'est
  // renseignée (0 € avec des leads = donnée incomplète, pas une performance).
  return Array.from(groups.entries()).map(([identityKey, g]) => {
    const cplNote: RankedVideo['cplNote'] = g.touchesSharedAudience
      ? 'shared_audience'
      : g.totalLeads <= 0
        ? 'no_leads'
        : g.totalSpend <= 0
          ? 'no_spend'
          : null
    return {
      identityKey,
      displayName: g.displayName,
      campaignCount: g.campaignNumbers.size,
      audienceType: g.audienceTypes.size > 1 ? 'both' : (g.audienceTypes.values().next().value ?? 'barbier'),
      totalLeads: g.touchesSharedAudience ? null : g.totalLeads,
      costPerLead: cplNote === null ? costPerMetaPixelLead(g.totalSpend, g.totalLeads) : null,
      cplNote,
      hookPlay: finalizeHookRate(g),
      retentionRate: finalizeRetentionRate(g),
      occurrences: withDetail ? occurrenceViews(g.occurrences, sharedAudienceIds) : [],
    }
  })
}

// Partie pure (aucune lecture base) : occurrences, détection des audiences à
// plusieurs vidéos, puis les trois vues filtrées.
export function rankVideoRows(
  audiences: RankingAudienceRow[],
  videos: RankingVideoRow[],
  campaigns: { id: string; campaign_number: number; sync_locked: boolean }[]
): RankedVideosByAudience {
  const audienceById = new Map(audiences.map((a) => [a.id, a]))
  const campaignById = new Map(campaigns.map((c) => [c.id, c]))

  const occurrences: VideoOccurrence[] = []
  for (const video of videos) {
    const audience = audienceById.get(video.audience_id)
    if (!audience) continue
    const displayName = video.video_display_name?.trim() || video.name.trim() || 'Vidéo'
    occurrences.push({
      video,
      audience,
      campaign: campaignById.get(audience.campaign_id),
      identityKey: videoIdentityKey(displayName),
      displayName,
    })
  }
  const canonical = canonicalDisplayNames(occurrences)
  for (const o of occurrences) o.displayName = canonical.get(o.identityKey) ?? o.displayName

  // Une audience portant plusieurs vidéos DISTINCTES (identités différentes)
  // est partagée. La même vidéo présente deux fois dans une audience reste
  // une seule vidéo : audience attribuable, comptée une fois.
  const identitiesByAudience = new Map<string, Set<string>>()
  for (const o of occurrences) {
    const keys = identitiesByAudience.get(o.audience.id) ?? new Set<string>()
    keys.add(o.identityKey)
    identitiesByAudience.set(o.audience.id, keys)
  }
  const sharedAudienceIds = new Set(
    Array.from(identitiesByAudience.entries())
      .filter(([, keys]) => keys.size > 1)
      .map(([audienceId]) => audienceId)
  )

  return {
    all: rankOccurrences(occurrences, sharedAudienceIds),
    barbier: rankOccurrences(occurrences.filter((o) => o.audience.audience_type === 'barbier'), sharedAudienceIds),
    coiffeur: rankOccurrences(occurrences.filter((o) => o.audience.audience_type === 'coiffeur'), sharedAudienceIds),
  }
}
