import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logger'
import {
  campaignDurationDays,
  costPerMetaPixelLead,
  hookRateThruplay,
  isDateRangePreset,
  parisDateFromInstant,
  realAppointments,
  realCostPerAppointment,
  resolveDateRange,
  retentionRate,
  trackingGap,
} from '@/lib/calculations'
import { buildDateRangeQueryString } from '@/lib/dateRangeQuery'
import KpiCard from '../../KpiCard'
import {
  amber,
  faint,
  formatCost,
  formatEur,
  formatPeriod,
  gray,
  green,
  headerBg,
  indigo,
  ink,
  lavender,
  line,
  muted,
  onDark,
  onDarkMuted,
  radius,
  red,
  softBg,
  surface,
  surfaceAlt,
  violet,
} from '../../format'
import { CalendarIcon, ClockIcon, DollarIcon, PlayIcon, TrackingIcon, TrendingUpIcon, UserIcon } from '../../icons'

function formatPct(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(1).replace('.', ',')} %`
}

type ChannelBreakdown = { channel: string; count: number; ratio: number }

// Regroupement insensible à la casse et aux espaces superflus (ex.
// "Instagram" / " instagram " comptent comme un seul canal), sans jamais
// fusionner des canaux réellement différents (ex. "Google" et "Google Ads"
// restent distincts) : la clé de regroupement est normalisée, mais
// l'étiquette affichée reste la première valeur réelle rencontrée pour ce
// canal, telle quelle (aucune donnée inventée). null/vide -> "Non renseigné".
function groupByAcquisitionChannel(rawChannels: (string | null)[]): ChannelBreakdown[] {
  const total = rawChannels.length
  if (total === 0) return []

  const groups = new Map<string, { label: string; count: number }>()
  for (const raw of rawChannels) {
    const trimmed = (raw ?? '').trim()
    const label = trimmed === '' ? 'Non renseigné' : trimmed
    const key = label.toLowerCase()
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      groups.set(key, { label, count: 1 })
    }
  }

  return Array.from(groups.values())
    .map(({ label, count }) => ({ channel: label, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count)
}

// Couleurs des segments du donut « Rendez-vous par canal », ordre fixe
// (jamais réattribué si un canal disparaît/apparaît d'une page à l'autre),
// toutes déjà présentes dans la palette — aucune teinte inventée.
const CHANNEL_COLORS = [indigo, violet, amber, green, red, gray]

type DonutSegment = { color: string; dasharray: string; dashoffset: number }

function donutSegments(rows: ChannelBreakdown[], donutTotal: number, radiusPx: number): DonutSegment[] {
  const circumference = 2 * Math.PI * radiusPx
  let cumulative = 0
  return rows.map((row, i) => {
    const fraction = donutTotal > 0 ? row.count / donutTotal : 0
    const dash = fraction * circumference
    const segment: DonutSegment = {
      color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
      dasharray: `${dash} ${Math.max(0, circumference - dash)}`,
      dashoffset: -cumulative,
    }
    cumulative += dash
    return segment
  })
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const { id } = await params
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

  const { data: profile } = await supabase.from('profiles').select('role, client_id').eq('id', user.id).maybeSingle()

  if (!profile?.client_id) {
    notFound()
  }

  const isAdmin = profile.role === 'admin'

  // La campagne doit appartenir exclusivement au client de l'utilisateur
  // authentifié : jamais un autre client, admin ou non.
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, campaign_number, start_date, end_date, status, meta_spend, meta_pixel_leads, manual_appointments_adjustment')
    .eq('id', id)
    .eq('client_id', profile.client_id)
    .maybeSingle()

  if (!campaign) {
    notFound()
  }

  // RDV réels rattachés à cette campagne : lus directement dans appointments
  // (status='active'), pas depuis campaigns.calendly_appointments qui reste
  // à 0 par défaut (jamais écrit par la synchro). Une seule requête sert à
  // la fois le total (KPI, hors période) et la répartition par canal
  // ci-dessous (start_time sert au filtrage par période, Europe/Paris).
  const { data: activeAppointmentRows, error: appointmentsError } = await supabase
    .from('appointments')
    .select('acquisition_channel, start_time')
    .eq('client_id', profile.client_id)
    .eq('campaign_id', campaign.id)
    .eq('status', 'active')

  if (appointmentsError) {
    logError('api', `campagne ${campaign.id}`, `lecture rendez-vous : ${appointmentsError.message}`)
  }

  const activeAppointments = activeAppointmentRows ?? []

  // Période active : la répartition par canal ne porte que sur les
  // rendez-vous dont la date métier (Europe/Paris) tombe dans la période —
  // cohérent avec le KPI "RDV confirmés" ci-dessous, lui-même basé sur
  // campaign_daily_stats.
  const channelSourceAppointments = resolvedRange
    ? activeAppointments.filter((a) => {
        const statDate = parisDateFromInstant(a.start_time)
        return statDate >= resolvedRange.start && statDate <= resolvedRange.end
      })
    : activeAppointments

  const channelBreakdown = groupByAcquisitionChannel(channelSourceAppointments.map((a) => a.acquisition_channel))

  // manual_appointments_adjustment est un correctif global à la campagne,
  // sans date ni canal associés — jamais appliqué à une période (même règle
  // qu'ailleurs, voir BRIEF-CLAUDE-CODE.md). Uniquement pertinent hors
  // période, où le KPI "RDV confirmés" l'inclut : affiché comme ligne à part
  // (jamais fondu dans un canal réel) pour que la somme du détail reste
  // strictement égale au KPI.
  const manualAdjustmentForBreakdown = resolvedRange ? 0 : campaign.manual_appointments_adjustment
  const channelTotal = channelBreakdown.reduce((sum, row) => sum + row.count, 0)
  const breakdownGrandTotal = channelTotal + manualAdjustmentForBreakdown

  const { data: audiences } = await supabase
    .from('audiences')
    .select('id, audience_type, name, meta_spend, meta_pixel_leads')
    .eq('campaign_id', campaign.id)
    .order('audience_type', { ascending: true })

  const audienceIds = (audiences ?? []).map((a) => a.id)

  const { data: videos } =
    audienceIds.length > 0
      ? await supabase
          .from('videos')
          .select(
            'id, audience_id, name, impressions, video_plays, thruplays, average_watch_time_seconds, video_p25, video_p50, video_p75, video_p100'
          )
          .in('audience_id', audienceIds)
      : { data: [] }

  const duration = campaignDurationDays(campaign.start_date, campaign.end_date)

  // ─── KPI : période active (sommes exactes campaign_daily_stats) ou totaux
  // campagne (comportement historique inchangé si aucune période active) ───
  let realAppointmentsCount: number
  let spendForKpis: number
  let metaPixelLeadsForKpis: number

  if (resolvedRange) {
    const { data: dailyRows } = await supabase
      .from('campaign_daily_stats')
      .select('meta_spend, meta_pixel_leads, calendly_appointments')
      .eq('campaign_id', campaign.id)
      .gte('stat_date', resolvedRange.start)
      .lte('stat_date', resolvedRange.end)

    const rows = dailyRows ?? []
    spendForKpis = rows.reduce((sum, r) => sum + r.meta_spend, 0)
    metaPixelLeadsForKpis = rows.reduce((sum, r) => sum + r.meta_pixel_leads, 0)
    // Pas d'ajustement manuel ici : manual_appointments_adjustment est une
    // correction globale à la campagne, sans date associée — l'appliquer à
    // une période reviendrait à estimer une répartition inexistante
    // (interdit, voir BRIEF-CLAUDE-CODE.md).
    realAppointmentsCount = rows.reduce((sum, r) => sum + r.calendly_appointments, 0)
  } else {
    spendForKpis = campaign.meta_spend
    metaPixelLeadsForKpis = campaign.meta_pixel_leads
    realAppointmentsCount = realAppointments(activeAppointments.length, campaign.manual_appointments_adjustment)
  }

  const realCostPerAppt = realCostPerAppointment(spendForKpis, realAppointmentsCount)
  const trackingGapValue = trackingGap(realAppointmentsCount, metaPixelLeadsForKpis)
  const costPerLead = costPerMetaPixelLead(spendForKpis, metaPixelLeadsForKpis)

  return (
    <main style={{ padding: '40px 40px 64px', color: ink }}>
      <style>{`
        .amerys-audience-grid { grid-template-columns: 1fr 1fr; }
        @media (max-width: 640px) {
          .amerys-audience-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
        <Link
          href={`/dashboard${queryString}`}
          style={{
            border: `1px solid ${line}`,
            background: surface,
            borderRadius: 10,
            width: 34,
            height: 34,
            display: 'grid',
            placeItems: 'center',
            color: muted,
            textDecoration: 'none',
          }}
        >
          ←
        </Link>
        <div>
          <div
            style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: faint }}
          >
            Détail campagne
          </div>
          <h1 style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-.01em' }}>Campagne {campaign.campaign_number}</h1>
        </div>
        {campaign.status ? (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 999,
              background: surfaceAlt,
              color: muted,
            }}
          >
            {campaign.status}
          </span>
        ) : null}
      </div>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 4 }}>
        {resolvedRange
          ? formatPeriod(resolvedRange.start, resolvedRange.end)
          : formatPeriod(campaign.start_date, campaign.end_date)}
        {!resolvedRange && duration !== null ? ` · ${duration} jour${duration > 1 ? 's' : ''}` : ''}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, margin: '30px 0' }}>
        <KpiCard
          icon={<DollarIcon size={20} />}
          iconColor={indigo}
          iconBg={lavender}
          label="Budget dépensé"
          value={`${formatEur(spendForKpis)} €`}
        />
        <KpiCard
          icon={<CalendarIcon size={20} />}
          iconColor={violet}
          iconBg={lavender}
          label="RDV confirmés"
          value={String(realAppointmentsCount)}
          foot="rendez-vous Calendly rattachés"
        />
        <KpiCard
          icon={<UserIcon size={20} />}
          iconColor={amber}
          iconBg={softBg(amber, 0.14)}
          label="Coût réel / RDV"
          value={formatCost(realCostPerAppt)}
          foot="dépensé ÷ RDV Calendly"
        />
        <KpiCard
          icon={<ClockIcon size={20} />}
          iconColor={green}
          iconBg={softBg(green, 0.14)}
          label="Durée"
          value={duration !== null ? `${duration} j` : '—'}
          foot={duration === null ? 'non disponible' : 'campagne entière'}
        />
        <KpiCard
          icon={<TrendingUpIcon size={20} />}
          iconColor={gray}
          iconBg={softBg(gray, 0.12)}
          label="Leads Meta"
          value={String(metaPixelLeadsForKpis)}
          foot="conversions pixel"
        />
        <KpiCard
          icon={<DollarIcon size={20} />}
          iconColor={gray}
          iconBg={softBg(gray, 0.12)}
          label="Coût / lead"
          value={formatCost(costPerLead)}
          foot="dépensé ÷ leads Meta (pixel)"
        />
        {isAdmin ? (
          <KpiCard
            icon={<TrackingIcon size={20} />}
            iconColor={gray}
            iconBg={softBg(gray, 0.12)}
            label="Écart de tracking"
            value={String(trackingGapValue)}
            foot="RDV Calendly − leads Meta"
          />
        ) : null}
      </div>

      <div style={{ marginTop: 32, marginBottom: 16 }}>
        <h2 style={{ fontWeight: 700, fontSize: 17 }}>Rendez-vous par canal d&apos;acquisition</h2>
      </div>

      {breakdownGrandTotal === 0 ? (
        <p style={{ color: muted }}>
          Aucun rendez-vous confirmé pour cette campagne{resolvedRange ? ' sur cette période' : ''}.
        </p>
      ) : (
        <div
          style={{
            background: surface,
            border: `1px solid ${line}`,
            borderRadius: radius,
            padding: 20,
            display: 'flex',
            gap: 28,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <svg width={140} height={140} viewBox="0 0 140 140" style={{ flexShrink: 0 }} role="img" aria-label={`${channelTotal} rendez-vous répartis par canal d'acquisition`}>
            <circle cx={70} cy={70} r={54} fill="none" stroke={surfaceAlt} strokeWidth={18} />
            {donutSegments(channelBreakdown, channelTotal, 54).map((seg, i) => (
              <circle
                key={channelBreakdown[i].channel}
                cx={70}
                cy={70}
                r={54}
                fill="none"
                stroke={seg.color}
                strokeWidth={18}
                strokeDasharray={seg.dasharray}
                strokeDashoffset={seg.dashoffset}
                transform="rotate(-90 70 70)"
              />
            ))}
            <text x={70} y={65} textAnchor="middle" fontSize={22} fontWeight={700} fill={ink}>
              {breakdownGrandTotal}
            </text>
            <text x={70} y={83} textAnchor="middle" fontSize={11} fill={muted}>
              RDV
            </text>
          </svg>

          <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {channelBreakdown.map((row, i) => (
              <div key={row.channel} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{row.channel}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{row.count}</span>
                <span style={{ fontSize: 12.5, color: muted, minWidth: 50, textAlign: 'right' }}>
                  {formatPct(row.count / breakdownGrandTotal)}
                </span>
              </div>
            ))}
            {manualAdjustmentForBreakdown !== 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  paddingTop: 10,
                  borderTop: `1px dashed ${line}`,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 3, background: faint, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: muted }}>Ajustement manuel</span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {manualAdjustmentForBreakdown > 0 ? '+' : ''}
                  {manualAdjustmentForBreakdown}
                </span>
                <span style={{ fontSize: 12.5, color: muted, minWidth: 50, textAlign: 'right' }}>
                  {formatPct(manualAdjustmentForBreakdown / breakdownGrandTotal)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, marginBottom: 16 }}>
        <h2 style={{ fontWeight: 700, fontSize: 17 }}>
          Barbier vs Coiffeur
          {resolvedRange ? (
            <span style={{ fontWeight: 600, fontSize: 12.5, color: faint, marginLeft: 8 }}>(total campagne)</span>
          ) : null}
        </h2>
        {resolvedRange ? (
          <p style={{ color: faint, fontSize: 12.5, marginTop: 2 }}>
            Pas de détail journalier par audience/vidéo — ces chiffres portent sur toute la durée de la campagne,
            pas sur la période sélectionnée.
          </p>
        ) : null}
      </div>

      {(audiences ?? []).length === 0 ? (
        <p style={{ color: muted }}>Aucune audience disponible pour cette campagne.</p>
      ) : (
        <div className="amerys-audience-grid" style={{ display: 'grid', gap: 18 }}>
          {(() => {
            // Comparaison réelle entre les deux audiences (jamais de donnée
            // inventée) : badge "Meilleur coût/lead" uniquement si au moins
            // deux valeurs valides et distinctes existent.
            const costsPerLead = (audiences ?? [])
              .map((a) => costPerMetaPixelLead(a.meta_spend, a.meta_pixel_leads))
              .filter((c): c is number => c !== null)
            const distinctCosts = new Set(costsPerLead)
            const bestCostPerLead = distinctCosts.size >= 2 ? Math.min(...costsPerLead) : null

            return (audiences ?? []).map((audience) => {
              const video = (videos ?? []).find((v) => v.audience_id === audience.id) ?? null
              const audienceCostPerLead = costPerMetaPixelLead(audience.meta_spend, audience.meta_pixel_leads)
              const isBarbier = audience.audience_type === 'barbier'
              const badgeColor = isBarbier ? indigo : violet
              const badgeSoft = isBarbier ? lavender : softBg(violet, 0.14)
              const isBestCostPerLead = bestCostPerLead !== null && audienceCostPerLead === bestCostPerLead

              const hookThru = video ? hookRateThruplay(video.thruplays, video.impressions) : null
              const retention = video ? retentionRate(video.video_p100, video.video_p25) : null

              return (
                <div
                  key={audience.id}
                  style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}
                >
                  {/* Bannière vidéo : aucune miniature réelle disponible (Meta
                      ne fournit pas d'URL d'image dans les métriques lues,
                      et le schéma n'en stocke pas — hors périmètre ici).
                      Icône Play purement décorative (pas de lecture vidéo
                      réelle), badge vues et badge Meilleur coût/lead réels. */}
                  <div
                    style={{
                      position: 'relative',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: headerBg,
                      aspectRatio: '16 / 9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {video ? (
                      <>
                        <PlayIcon size={40} style={{ color: onDark }} />
                        <span
                          style={{
                            position: 'absolute',
                            top: 10,
                            left: 10,
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: 999,
                            background: 'rgba(0, 0, 0, 0.45)',
                            color: onDark,
                          }}
                        >
                          {video.video_plays.toLocaleString('fr-FR')} vues
                        </span>
                        {isBestCostPerLead ? (
                          <span
                            style={{
                              position: 'absolute',
                              top: 10,
                              right: 10,
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '3px 9px',
                              borderRadius: 999,
                              background: green,
                              color: onDark,
                            }}
                          >
                            Meilleur coût/lead
                          </span>
                        ) : null}
                        <span
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            padding: '20px 10px 8px',
                            background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.7))',
                            color: onDark,
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {video.name}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: onDarkMuted, fontSize: 12.5 }}>Aucune vidéo disponible</span>
                    )}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: badgeSoft,
                        color: badgeColor,
                      }}
                    >
                      {isBarbier ? 'Barbier' : 'Coiffeur'}
                    </span>
                  </div>

                  <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                    marginTop: 14,
                    paddingBottom: 13,
                    borderBottom: `1px solid ${line}`,
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{formatEur(audience.meta_spend)} €</div>
                    <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Dépensé</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{audience.meta_pixel_leads}</div>
                    <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Leads Meta</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{formatCost(audienceCostPerLead)}</div>
                    <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Coût/lead</div>
                  </div>
                </div>

                {video ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>{video.impressions.toLocaleString('fr-FR')}</div>
                        <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Impressions</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>
                          {video.average_watch_time_seconds.toLocaleString('fr-FR')} s
                        </div>
                        <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Durée moyenne de lecture</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 13 }}>
                      <div style={{ flex: 1, textAlign: 'center', borderRadius: 10, padding: '9px 4px', background: surfaceAlt }}>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{formatPct(hookThru)}</div>
                        <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Accroche (thruplay)</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', borderRadius: 10, padding: '9px 4px', background: surfaceAlt }}>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{formatPct(retention)}</div>
                        <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Rétention</div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )
          })
          })()}
        </div>
      )}
    </main>
  )
}
