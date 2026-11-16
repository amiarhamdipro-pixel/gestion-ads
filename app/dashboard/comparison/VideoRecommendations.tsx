import { accent, amber, gray, green, ink, line, muted, radius, softBg, surface, surfaceAlt } from '../format'
import type { RankedVideo, RankedVideosByAudience } from './VideoRanking'

// Recommandations vidéo — ADMIN UNIQUEMENT. Composant serveur (aucun
// 'use client') : page.tsx ne l'appelle que si isAdmin, donc rien n'est
// calculé ni rendu pour un client (ni HTML, ni données sérialisées). Jamais
// transmis à VideoRanking (composant navigateur).
//
// Aucune donnée recalculée : la sélection repose sur les vues déjà calculées
// par computeRankedVideos (page.tsx) — coût/lead = Σdépenses ÷ Σleads des
// audiences attribuées (jamais une moyenne de CPL), audiences partagées déjà
// marquées non comparables (cplNote). Barbier et Coiffeur sont traités
// indépendamment, chacun sur sa propre vue filtrée.
//
// Seuils : repères métier validés, pas une garantie statistique.
export const MIN_LEADS = 10
export const CLOSE_CPL_RATIO = 0.1
export const CONFIRMED_MIN_LEADS = 20
export const CONFIRMED_MIN_CAMPAIGNS = 2

const EPSILON = 1e-9

export type Confidence = 'confirmed' | 'to_confirm'

export type VideoRecommendation =
  | {
      status: 'recommended'
      video: RankedVideo
      confidence: Confidence
      // 'all' : toutes les campagnes de la vidéo (dans cette audience) sont
      // verrouillées ; 'partial' : une partie seulement.
      historical: 'all' | 'partial' | null
    }
  | { status: 'none'; reason: string }

function isEligible(v: RankedVideo): boolean {
  return (
    v.cplNote === null &&
    v.costPerLead !== null &&
    Number.isFinite(v.costPerLead) &&
    v.costPerLead > 0 &&
    v.totalLeads !== null &&
    v.totalLeads >= MIN_LEADS &&
    v.campaignCount >= 1
  )
}

// Verrouillage : dérivé des occurrences (numéro de campagne) et de
// campaigns.sync_locked, déjà chargés par page.tsx — aucune requête.
function historicalStatus(v: RankedVideo, lockedCampaignNumbers: Set<number>): 'all' | 'partial' | null {
  const numbers = v.occurrences.map((o) => o.campaignNumber).filter((n): n is number => n !== null)
  const locked = numbers.filter((n) => lockedCampaignNumbers.has(n)).length
  if (locked === 0) return null
  return locked === numbers.length ? 'all' : 'partial'
}

function noneReason(videos: RankedVideo[]): string {
  if (videos.length === 0) return 'Aucune vidéo pour cette audience.'
  const computable = videos.filter((v) => v.cplNote === null && v.costPerLead !== null && Number.isFinite(v.costPerLead) && v.costPerLead > 0)
  if (computable.length === 0) {
    return 'Aucune vidéo avec un coût/lead Meta calculable (audience partagée, leads ou dépenses manquants).'
  }
  return `Aucune vidéo n’atteint ${MIN_LEADS} leads Meta cumulés.`
}

// Sélection :
// 1. éligibilité (voir isEligible) ;
// 2. CPL le plus faible ; les vidéos dont le CPL est à ≤ 10 % du plus faible
//    sont considérées proches — seules celles-ci sont départagées :
// 3. par volume de leads (plus élevé), puis par accroche (plus élevée,
//    indisponible en dernier), puis par CPL, puis par identityKey (ordre
//    déterministe, indépendant de l'ordre d'entrée). La rétention n'est
//    jamais un critère.
export function recommendVideo(videos: RankedVideo[], lockedCampaignNumbers: Set<number>): VideoRecommendation {
  const eligible = videos.filter(isEligible)
  if (eligible.length === 0) return { status: 'none', reason: noneReason(videos) }

  const minCpl = Math.min(...eligible.map((v) => v.costPerLead as number))
  const close = eligible.filter((v) => ((v.costPerLead as number) - minCpl) / minCpl <= CLOSE_CPL_RATIO + EPSILON)

  const [best] = [...close].sort(
    (a, b) =>
      (b.totalLeads as number) - (a.totalLeads as number) ||
      (b.hookPlay ?? -Infinity) - (a.hookPlay ?? -Infinity) ||
      (a.costPerLead as number) - (b.costPerLead as number) ||
      a.identityKey.localeCompare(b.identityKey)
  )

  return {
    status: 'recommended',
    video: best,
    confidence:
      (best.totalLeads as number) >= CONFIRMED_MIN_LEADS && best.campaignCount >= CONFIRMED_MIN_CAMPAIGNS ? 'confirmed' : 'to_confirm',
    historical: historicalStatus(best, lockedCampaignNumbers),
  }
}

export function buildVideoRecommendations(
  views: RankedVideosByAudience,
  lockedCampaignNumbers: Set<number>
): { barbier: VideoRecommendation; coiffeur: VideoRecommendation } {
  return {
    barbier: recommendVideo(views.barbier, lockedCampaignNumbers),
    coiffeur: recommendVideo(views.coiffeur, lockedCampaignNumbers),
  }
}

function formatCost(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €'
}

function formatPct(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(1).replace('.', ',')} %`
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: ink, background: softBg(color, 0.16), borderRadius: 999, padding: '2px 7px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
      <span style={{ color: muted }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function AudienceSection({ title, recommendation }: { title: string; recommendation: VideoRecommendation }) {
  return (
    <div style={{ background: surfaceAlt, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: accent, marginBottom: 8 }}>{title}</h3>
      {recommendation.status === 'none' ? (
        <>
          <p style={{ fontSize: 13.5, fontWeight: 600 }}>Pas de recommandation fiable</p>
          <p style={{ fontSize: 12.5, color: muted, marginTop: 4 }}>{recommendation.reason}</p>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <b style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{recommendation.video.displayName}</b>
            <Badge
              label={recommendation.confidence === 'confirmed' ? 'Confirmée' : 'À confirmer'}
              color={recommendation.confidence === 'confirmed' ? green : amber}
            />
            {/* sync_locked marque une campagne verrouillée (historique Excel OU
                campagne publiée figée) : jamais présenté comme un import Excel. */}
            {recommendation.historical ? (
              <Badge
                label={
                  recommendation.historical === 'partial'
                    ? 'Campagnes partiellement verrouillées'
                    : recommendation.video.campaignCount > 1
                      ? 'Campagnes verrouillées'
                      : 'Campagne verrouillée'
                }
                color={gray}
              />
            ) : null}
          </div>
          <Stat label="Coût/lead Meta" value={formatCost(recommendation.video.costPerLead as number)} />
          <Stat label="Leads Meta" value={String(recommendation.video.totalLeads)} />
          <Stat label="Campagnes" value={String(recommendation.video.campaignCount)} />
          <Stat label="Accroche" value={formatPct(recommendation.video.hookPlay)} />
          <Stat label="Rétention" value={formatPct(recommendation.video.retentionRate)} />
        </>
      )}
    </div>
  )
}

export default function VideoRecommendations({
  recommendations,
}: {
  recommendations: { barbier: VideoRecommendation; coiffeur: VideoRecommendation }
}) {
  return (
    <section style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 18, marginBottom: 20 }}>
      <h2 style={{ fontWeight: 600, fontSize: 17 }}>Recommandations vidéo</h2>
      <p style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
        Toutes périodes · réservé à l’admin · coût/lead Meta de l’audience, au moins {MIN_LEADS} leads ; « Confirmée » = au
        moins {CONFIRMED_MIN_LEADS} leads sur {CONFIRMED_MIN_CAMPAIGNS} campagnes (repère métier, pas une garantie statistique).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 14 }}>
        <AudienceSection title="Barbier" recommendation={recommendations.barbier} />
        <AudienceSection title="Coiffeur" recommendation={recommendations.coiffeur} />
      </div>
    </section>
  )
}
