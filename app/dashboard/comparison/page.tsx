import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  appointmentsPerDay,
  campaignDurationDays,
  costPerMetaPixelLead,
  isDateRangePreset,
  realAppointments,
  realCostPerAppointment,
  resolveDateRange,
} from '@/lib/calculations'
import { buildDateRangeQueryString } from '@/lib/dateRangeQuery'
import { logError } from '@/lib/logger'
import { accent, formatCost, formatEur, formatPeriod, green, ink, line, muted, radius, softBg, surface, surfaceAlt } from '../format'
import EmptyPeriodState from '../EmptyPeriodState'
import VideoRanking, { type RankedVideo } from './VideoRanking'

type CampaignRow = {
  id: string
  campaign_number: number
  start_date: string | null
  end_date: string | null
  meta_spend: number
  meta_pixel_leads: number
  manual_appointments_adjustment: number
  sync_locked: boolean
  calendlyAppointments: number
}

function formatDuration(days: number | null): string {
  return days === null ? '—' : `${days} j`
}

function formatPerDay(n: number | null): string {
  return n === null ? '—' : n.toFixed(2).replace('.', ',')
}

// Badge "top" sobre : petite étiquette discrète (pas un texte vert criard),
// même logique de mise en avant qu'avant (colonnes RDV/j et coût réel/RDV
// uniquement), juste un traitement visuel plus premium/cohérent avec le
// reste de l'interface.
function TopBadge() {
  return (
    <span
      style={{
        marginLeft: 6,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '.03em',
        textTransform: 'uppercase',
        // color: ink, pas green — green sur son propre fond pâle (softBg)
        // tombe à ~2:1 de contraste, illisible ; ink sur ce même fond reste
        // proche du contraste ink/blanc (~17:1), fond coloré conservé.
        color: ink,
        background: softBg(green, 0.14),
        borderRadius: 999,
        padding: '2px 7px',
      }}
    >
      Top
    </span>
  )
}

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
// comparaison (trim + casse insensible), jamais pour l'affichage (le nom
// exact, extension .mp4 incluse, est conservé tel quel dans RankedVideo.
// displayName). Deux vidéos dont les noms diffèrent réellement, même
// proches, restent deux lignes distinctes.
async function computeRankedVideos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaigns: { id: string; campaign_number: number; sync_locked: boolean }[]
): Promise<RankedVideo[]> {
  if (campaigns.length === 0) return []

  const { data: audienceData } = await supabase
    .from('audiences')
    .select('id, campaign_id, audience_type, meta_spend, meta_pixel_leads')
    .in(
      'campaign_id',
      campaigns.map((c) => c.id)
    )
  const audiences = audienceData ?? []
  if (audiences.length === 0) return []

  const { data: videoData } = await supabase
    .from('videos')
    .select('audience_id, name, video_display_name, impressions, video_plays, video_plays_3s, video_p100, hook_rate_pct, retention_rate_pct')
    .in(
      'audience_id',
      audiences.map((a) => a.id)
    )
  const videos = videoData ?? []

  const audienceById = new Map(audiences.map((a) => [a.id, a]))
  const campaignByAudienceId = new Map(audiences.map((a) => [a.id, a.campaign_id]))
  const campaignById = new Map(campaigns.map((c) => [c.id, c]))

  type VideoGroup = {
    displayName: string
    audienceType: 'barbier' | 'coiffeur'
    campaignNumbers: Set<number>
    totalSpend: number
    totalLeads: number
    // Accroche et rétention agrégées indépendamment l'une de l'autre (une
    // occurrence peut avoir l'une en pct Excel et l'autre en compteurs bruts
    // — même règle de priorité par champ que campaigns/[id]/page.tsx :
    // sync_locked + pct non nul -> le pct Excel gouverne CETTE occurrence
    // pour CE champ ; sinon -> ses compteurs bruts contribuent aux sommes
    // "raw" ci-dessous. Formule finale unique (voir finalizeRate) : jamais
    // de moyenne simple, jamais de source silencieusement privilégiée.
    rawHookImpressions: number
    rawHookPlays3s: number
    excelHookWeightedSum: number
    excelHookWeight: number
    rawRetentionPlays3s: number
    rawRetentionP100: number
    excelRetentionWeightedSum: number
    excelRetentionWeight: number
  }

  const groups = new Map<string, VideoGroup>()
  for (const video of videos) {
    const audience = audienceById.get(video.audience_id)
    if (!audience) continue

    const campaignId = campaignByAudienceId.get(video.audience_id)
    const campaign = campaignId ? campaignById.get(campaignId) : undefined
    const campaignNumber = campaign?.campaign_number

    const displayName = video.video_display_name?.trim() || video.name.trim() || 'Vidéo'
    const identityKey = displayName.toLowerCase()

    let group = groups.get(identityKey)
    if (!group) {
      group = {
        displayName,
        audienceType: audience.audience_type,
        campaignNumbers: new Set<number>(),
        totalSpend: 0,
        totalLeads: 0,
        rawHookImpressions: 0,
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

    group.totalSpend += audience.meta_spend
    group.totalLeads += audience.meta_pixel_leads
    if (campaignNumber !== undefined) group.campaignNumbers.add(campaignNumber)

    const hookFromExcel = Boolean(campaign?.sync_locked) && video.hook_rate_pct != null
    if (hookFromExcel) {
      // Pondération par les vues (video_plays, toujours renseigné — voir
      // types/database.ts) : le volume le plus pertinent réellement
      // disponible pour une occurrence Excel, qui n'a pas de compteurs bruts
      // impressions/video_plays_3s. Jamais une moyenne simple non pondérée.
      group.excelHookWeightedSum += (video.hook_rate_pct as number) * video.video_plays
      group.excelHookWeight += video.video_plays
    } else {
      // impressions/video_plays_3s peuvent être null (vidéo historique
      // jamais synchronisée) : une contribution "inconnue" compte pour 0
      // dans la SOMME du groupe, jamais inventée.
      group.rawHookImpressions += video.impressions ?? 0
      group.rawHookPlays3s += video.video_plays_3s ?? 0
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
  // des deux : numérateur = Σ(video_plays_3s bruts) + Σ(hook_rate_pct_excel
  // × video_plays_excel) ; dénominateur = Σ(impressions brutes) +
  // Σ(video_plays_excel). Cette formule se réduit exactement à
  // hookRate(Σplays3s, Σimpressions) — la formule déjà utilisée avant cette
  // tâche — quand toutes les occurrences sont dynamiques (aucun terme
  // Excel), et à la moyenne pondérée par les vues quand toutes sont
  // historiques (aucun terme brut) : une seule règle documentée, jamais de
  // source privilégiée silencieusement en cas de mélange.
  function finalizeHookRate(g: VideoGroup): number | null {
    const numerator = g.rawHookPlays3s + g.excelHookWeightedSum
    const denominator = g.rawHookImpressions + g.excelHookWeight
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
  // ratio des totaux agrégés (Σdépenses ÷ Σleads) — costPerMetaPixelLead
  // renvoie déjà null si Σleads = 0 (aucun lead total -> "—", jamais classée
  // meilleure vidéo, voir VideoRanking.tsx). meta_pixel_leads n'est jamais
  // null (voir types/database.ts, Audience) : une occurrence sans lead
  // contribue un vrai 0 à la somme, jamais une valeur inventée.
  return Array.from(groups.values()).map((g) => ({
    identityKey: g.displayName.toLowerCase(),
    displayName: g.displayName,
    campaignCount: g.campaignNumbers.size,
    audienceType: g.audienceType,
    costPerLead: costPerMetaPixelLead(g.totalSpend, g.totalLeads),
    hookPlay: finalizeHookRate(g),
    retentionRate: finalizeRetentionRate(g),
  }))
}

export default async function ComparisonPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const { period, from, to } = await searchParams
  const activePreset = isDateRangePreset(period) ? period : null
  const resolvedRange = activePreset ? resolveDateRange(activePreset, { start: from ?? null, end: to ?? null }) : null
  const queryString = buildDateRangeQueryString({ period, from, to })

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase.from('profiles').select('client_id, role').eq('id', user.id).maybeSingle()
  const isAdmin = profile?.role === 'admin'

  if (!profile?.client_id) {
    return (
      <main style={{ padding: '40px 40px 64px', color: ink }}>
        <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Comparaison</h1>
        <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Toutes les campagnes ramenées à armes égales</p>
        <p style={{ marginTop: 20, color: muted }}>Aucun client associé à ce compte.</p>
      </main>
    )
  }

  // ─── Période active : RDV/dépensé/coût-RDV exacts issus de
  // campaign_daily_stats — jamais une estimation depuis les totaux campagne ──
  if (resolvedRange) {
    const { data: campaignMetaRaw, error: campaignMetaError } = await supabase
      .from('campaigns')
      .select('id, campaign_number, published, sync_locked')
      .eq('client_id', profile.client_id)
      .order('campaign_number', { ascending: true })

    // État de publication (indépendant du statut Meta) : le client ne voit
    // que les campagnes published=true, décision exclusivement admin (voir
    // aussi app/dashboard/page.tsx et campaigns/[id]/page.tsx). L'admin voit
    // tout, y compris les campagnes non encore publiées.
    const campaignMeta = (campaignMetaRaw ?? []).filter((c) => isAdmin || c.published)

    if (campaignMetaError) {
      return (
        <main style={{ padding: '40px 40px 64px', color: ink }}>
          <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Comparaison</h1>
          <p style={{ marginTop: 20, color: '#D93A3A' }}>Impossible de charger les données pour le moment. Réessayez plus tard.</p>
        </main>
      )
    }

    const { data: dailyRowsRaw, error: dailyError } = await supabase
      .from('campaign_daily_stats')
      .select('campaign_id, meta_spend, meta_pixel_leads, calendly_appointments')
      .eq('client_id', profile.client_id)
      .gte('stat_date', resolvedRange.start)
      .lte('stat_date', resolvedRange.end)

    if (dailyError) {
      return (
        <main style={{ padding: '40px 40px 64px', color: ink }}>
          <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Comparaison</h1>
          <p style={{ marginTop: 20, color: '#D93A3A' }}>Impossible de charger les statistiques journalières. Réessayez plus tard.</p>
        </main>
      )
    }

    const dailyRows = dailyRowsRaw ?? []

    if (dailyRows.length === 0) {
      return (
        <main style={{ padding: '40px 40px 64px', color: ink }}>
          <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Comparaison</h1>
          <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>{formatPeriod(resolvedRange.start, resolvedRange.end)}</p>
          <div style={{ marginTop: 24 }}>
            <EmptyPeriodState />
          </div>
        </main>
      )
    }

    const byCampaign = new Map<string, { spend: number; leads: number; appointments: number }>()
    for (const row of dailyRows) {
      const agg = byCampaign.get(row.campaign_id) ?? { spend: 0, leads: 0, appointments: 0 }
      agg.spend += row.meta_spend
      agg.leads += row.meta_pixel_leads
      agg.appointments += row.calendly_appointments
      byCampaign.set(row.campaign_id, agg)
    }

    // Dénominateur unique (durée de la période sélectionnée) pour RDV/jour :
    // comparable entre campagnes à armes égales, contrairement à la durée
    // propre de chaque campagne.
    const periodDurationDays = campaignDurationDays(resolvedRange.start, resolvedRange.end)

    const periodRows = (campaignMeta ?? [])
      .filter((c) => byCampaign.has(c.id))
      .map((c) => {
        const agg = byCampaign.get(c.id)!
        return {
          id: c.id,
          campaignNumber: c.campaign_number,
          spend: agg.spend,
          leads: agg.leads,
          appointments: agg.appointments,
          appointmentsPerDayValue: appointmentsPerDay(agg.appointments, periodDurationDays),
          realCostPerAppt: realCostPerAppointment(agg.spend, agg.appointments),
        }
      })

    const bestAppointmentsPerDay = Math.max(
      ...periodRows.map((r) => r.appointmentsPerDayValue).filter((v): v is number => v !== null)
    )
    const bestRealCostPerAppointment = Math.min(
      ...periodRows.map((r) => r.realCostPerAppt).filter((v): v is number => v !== null)
    )
    const hasBestAppointmentsPerDay = Number.isFinite(bestAppointmentsPerDay)
    const hasBestRealCostPerAppointment = Number.isFinite(bestRealCostPerAppointment)

    // Classement vidéos : toujours toutes périodes confondues (voir
    // computeRankedVideos), calculé sur l'ensemble des campagnes du client —
    // pas seulement celles actives sur la période sélectionnée.
    const rankedVideos = await computeRankedVideos(supabase, campaignMeta ?? [])

    return (
      <main style={{ padding: '40px 40px 64px', color: ink }}>
        <style>{`
          .amerys-card-list { display: none; }
          @media (max-width: 640px) {
            .amerys-table-wrap { display: none; }
            .amerys-card-list { display: flex; }
          }
        `}</style>

        <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Comparaison</h1>
        <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>{formatPeriod(resolvedRange.start, resolvedRange.end)}</p>

        <div style={{ marginTop: 30, marginBottom: 16 }}>
          <h2 style={{ fontWeight: 700, fontSize: 17 }}>Campagnes côte à côte</h2>
          <p style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
            La meilleure valeur de chaque colonne comparable est mise en avant
          </p>
        </div>

        <div className="amerys-table-wrap" style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {(isAdmin
                    ? ['Campagne', 'RDV Calendly', 'RDV / j', 'Dépensé', 'Coût réel / RDV', 'Leads Meta']
                    : ['Campagne', 'RDV Calendly', 'RDV / j', 'Dépensé', 'Coût réel / RDV']
                  ).map((label) => (
                    <th
                      key={label}
                      style={{
                        textAlign: label === 'Campagne' ? 'left' : 'right',
                        padding: '13px 16px',
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '.04em',
                        textTransform: 'uppercase',
                        color: muted,
                        background: surfaceAlt,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodRows.map((row, index) => {
                  const isBestAppointmentsPerDay = hasBestAppointmentsPerDay && row.appointmentsPerDayValue === bestAppointmentsPerDay
                  const isBestRealCostPerAppointment = hasBestRealCostPerAppointment && row.realCostPerAppt === bestRealCostPerAppointment
                  return (
                    <tr key={row.id} style={{ borderTop: index === 0 ? 'none' : `1px solid ${line}` }}>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600 }}>
                        <Link href={`/dashboard/campaigns/${row.id}${queryString}`} style={{ color: accent, textDecoration: 'none' }}>
                          Campagne {row.campaignNumber}
                        </Link>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right' }}>{row.appointments}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatPerDay(row.appointmentsPerDayValue)}
                        {isBestAppointmentsPerDay ? <TopBadge /> : null}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatEur(row.spend)} €
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatCost(row.realCostPerAppt)}
                        {isBestRealCostPerAppointment ? <TopBadge /> : null}
                      </td>
                      {isAdmin ? (
                        <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right', color: muted }}>{row.leads}</td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="amerys-card-list" style={{ flexDirection: 'column', gap: 12 }}>
          {periodRows.map((row) => {
            const isBestAppointmentsPerDay = hasBestAppointmentsPerDay && row.appointmentsPerDayValue === bestAppointmentsPerDay
            const isBestRealCostPerAppointment = hasBestRealCostPerAppointment && row.realCostPerAppt === bestRealCostPerAppointment
            return (
              <div key={row.id} style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}>
                <Link href={`/dashboard/campaigns/${row.id}${queryString}`} style={{ fontWeight: 600, fontSize: 15, color: accent, textDecoration: 'none' }}>
                  Campagne {row.campaignNumber}
                </Link>
                <div style={{ fontSize: 12.5, color: muted, marginTop: 3 }}>{row.appointments} RDV Calendly</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                      RDV / j
                    </div>
                    <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>
                      {formatPerDay(row.appointmentsPerDayValue)}
                      {isBestAppointmentsPerDay ? <TopBadge /> : null}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                      Dépensé
                    </div>
                    <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>{formatEur(row.spend)} €</div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 14,
                    paddingTop: 14,
                    borderTop: `1px solid ${line}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                      Coût / RDV réel
                    </div>
                    <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>
                      {formatCost(row.realCostPerAppt)}
                      {isBestRealCostPerAppointment ? <TopBadge /> : null}
                    </div>
                  </div>
                  {isAdmin ? <span style={{ color: muted, fontSize: 12.5 }}>{row.leads} leads Meta</span> : null}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 32 }}>
          <p style={{ color: muted, fontSize: 12.5, marginBottom: 10 }}>
            Classement des vidéos : toutes périodes confondues (pas de détail journalier par audience/vidéo).
          </p>
          <VideoRanking videos={rankedVideos} isAdmin={isAdmin} />
        </div>
      </main>
    )
  }

  // ─── Aucune période sélectionnée : vue historique inchangée ─────────────
  let campaigns: CampaignRow[] = []
  let loadError: string | null = null

  const { data: campaignData, error: campaignError } = await supabase
    .from('campaigns')
    .select(
      'id, campaign_number, start_date, end_date, meta_spend, meta_pixel_leads, manual_appointments_adjustment, published, sync_locked'
    )
    .eq('client_id', profile.client_id)
    .order('campaign_number', { ascending: true })

  if (campaignError) {
    loadError = campaignError.message
  } else {
    // État de publication (indépendant du statut Meta) : le client ne voit
    // que les campagnes published=true, décision exclusivement admin (voir
    // aussi app/dashboard/page.tsx et campaigns/[id]/page.tsx). L'admin voit
    // tout, y compris les campagnes non encore publiées.
    const loadedCampaigns = (campaignData ?? []).filter((c) => isAdmin || c.published)
    // RDV réels par campagne : comptés directement dans appointments
    // (status='active', campaign_id rattaché, client_id revérifié), pas
    // depuis campaigns.calendly_appointments qui reste à 0 par défaut
    // (jamais écrit par la synchro). Même principe que la vue d'ensemble
    // (app/dashboard/page.tsx).
    const counts = await Promise.all(
      loadedCampaigns.map(async (c) => {
        const { count, error: countError } = await supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', profile.client_id as string)
          .eq('campaign_id', c.id)
          .eq('status', 'active')
        if (countError) {
          logError('api', `campagne ${c.id}`, `comptage rendez-vous : ${countError.message}`)
        }
        return count ?? 0
      })
    )
    campaigns = loadedCampaigns.map((c, i) => ({ ...c, calendlyAppointments: counts[i] }))
  }

  // Comparatif campagnes : durée, RDV Calendly réels, RDV/jour, dépensé,
  // coût réel/RDV (leads Meta gardés en information secondaire).
  const comparisonRows = campaigns.map((campaign) => {
    const duration = campaignDurationDays(campaign.start_date, campaign.end_date)
    const realCount = realAppointments(campaign.calendlyAppointments, campaign.manual_appointments_adjustment)
    return {
      campaign,
      duration,
      realCount,
      appointmentsPerDayValue: appointmentsPerDay(realCount, duration),
      realCostPerAppt: realCostPerAppointment(campaign.meta_spend, realCount),
    }
  })

  // Mis en avant uniquement sur les métriques de performance comparables entre
  // campagnes (taux, coût) — pas sur les totaux bruts (dépensé, leads Meta),
  // qui ne sont pas comparables sans normalisation. Même principe que la
  // maquette (RDV/jour et coût réel/RDV uniquement surlignés).
  const bestAppointmentsPerDay = Math.max(
    ...comparisonRows.map((r) => r.appointmentsPerDayValue).filter((v): v is number => v !== null)
  )
  const bestRealCostPerAppointment = Math.min(
    ...comparisonRows.map((r) => r.realCostPerAppt).filter((v): v is number => v !== null)
  )
  const hasBestAppointmentsPerDay = Number.isFinite(bestAppointmentsPerDay)
  const hasBestRealCostPerAppointment = Number.isFinite(bestRealCostPerAppointment)

  const rankedVideos = await computeRankedVideos(supabase, campaigns)

  return (
    <main style={{ padding: '40px 40px 64px', color: ink }}>
      <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Comparaison</h1>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Toutes les campagnes ramenées à armes égales</p>

      {loadError ? (
        <p style={{ marginTop: 20, color: '#D93A3A' }}>Impossible de charger les données pour le moment. Réessayez plus tard.</p>
      ) : campaigns.length === 0 ? (
        <p style={{ marginTop: 20, color: muted }}>Aucune campagne synchronisée pour le moment.</p>
      ) : (
        <>
          <style>{`
            .amerys-card-list { display: none; }
            @media (max-width: 640px) {
              .amerys-table-wrap { display: none; }
              .amerys-card-list { display: flex; }
            }
          `}</style>

          <div style={{ marginTop: 30, marginBottom: 16 }}>
            <h2 style={{ fontWeight: 700, fontSize: 17 }}>Campagnes côte à côte</h2>
            <p style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
              La meilleure valeur de chaque colonne comparable est mise en avant
            </p>
          </div>

          {/* Desktop/tablette : tableau complet, scroll horizontal en filet de
              sécurité si l'espace est serré. */}
          <div className="amerys-table-wrap" style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    {(isAdmin
                      ? ['Campagne', 'Durée', 'RDV Calendly', 'RDV / j', 'Dépensé', 'Coût réel / RDV', 'Leads Meta']
                      : ['Campagne', 'Durée', 'RDV Calendly', 'RDV / j', 'Dépensé', 'Coût réel / RDV']
                    ).map((label) => (
                      <th
                        key={label}
                        style={{
                          textAlign: label === 'Campagne' ? 'left' : 'right',
                          padding: '13px 16px',
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '.04em',
                          textTransform: 'uppercase',
                          color: muted,
                          background: surfaceAlt,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row, index) => {
                    const isBestAppointmentsPerDay =
                      hasBestAppointmentsPerDay && row.appointmentsPerDayValue === bestAppointmentsPerDay
                    const isBestRealCostPerAppointment =
                      hasBestRealCostPerAppointment && row.realCostPerAppt === bestRealCostPerAppointment
                    return (
                      <tr key={row.campaign.id} style={{ borderTop: index === 0 ? 'none' : `1px solid ${line}` }}>
                        <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600 }}>
                          <Link href={`/dashboard/campaigns/${row.campaign.id}${queryString}`} style={{ color: accent, textDecoration: 'none' }}>
                            Campagne {row.campaign.campaign_number}
                          </Link>
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right' }}>{formatDuration(row.duration)}</td>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right' }}>{row.realCount}</td>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {formatPerDay(row.appointmentsPerDayValue)}
                          {isBestAppointmentsPerDay ? <TopBadge /> : null}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {formatEur(row.campaign.meta_spend)} €
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {formatCost(row.realCostPerAppt)}
                          {isBestRealCostPerAppointment ? <TopBadge /> : null}
                        </td>
                        {isAdmin ? (
                          <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'right', color: muted }}>
                            {row.campaign.meta_pixel_leads}
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile (<=640px) : une carte par campagne, aucune coupure horizontale. */}
          <div className="amerys-card-list" style={{ flexDirection: 'column', gap: 12 }}>
            {comparisonRows.map((row) => {
              const isBestAppointmentsPerDay =
                hasBestAppointmentsPerDay && row.appointmentsPerDayValue === bestAppointmentsPerDay
              const isBestRealCostPerAppointment =
                hasBestRealCostPerAppointment && row.realCostPerAppt === bestRealCostPerAppointment
              return (
                <div key={row.campaign.id} style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}>
                  <Link href={`/dashboard/campaigns/${row.campaign.id}${queryString}`} style={{ fontWeight: 600, fontSize: 15, color: accent, textDecoration: 'none' }}>
                    Campagne {row.campaign.campaign_number}
                  </Link>
                  <div style={{ fontSize: 12.5, color: muted, marginTop: 3 }}>
                    {formatDuration(row.duration)} · {row.realCount} RDV Calendly
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                        RDV / j
                      </div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>
                        {formatPerDay(row.appointmentsPerDayValue)}
                        {isBestAppointmentsPerDay ? <TopBadge /> : null}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                        Dépensé
                      </div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>{formatEur(row.campaign.meta_spend)} €</div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: `1px solid ${line}`,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                        Coût / RDV réel
                      </div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>
                        {formatCost(row.realCostPerAppt)}
                        {isBestRealCostPerAppointment ? <TopBadge /> : null}
                      </div>
                    </div>
                    {isAdmin ? (
                      <span style={{ color: muted, fontSize: 12.5 }}>{row.campaign.meta_pixel_leads} leads Meta</span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 32 }}>
            <VideoRanking videos={rankedVideos} isAdmin={isAdmin} />
          </div>
        </>
      )}
    </main>
  )
}
