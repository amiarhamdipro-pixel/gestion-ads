import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  campaignDurationDays,
  costPerMetaPixelLead,
  hookRatePlay,
  hookRateThruplay,
  realAppointments,
  realCostPerAppointment,
  retentionRate,
  trackingGap,
} from '@/lib/calculations'
import KpiCard from '../../KpiCard'
import {
  accent,
  faint,
  formatCost,
  formatEur,
  formatPeriod,
  ink,
  line,
  muted,
  radius,
  spendColor,
  surface,
  surfaceAlt,
} from '../../format'

// Couleurs d'audience reprises de dashboard-maquette_1.html (badges barber/coiffeur).
const teal = '#0E9AA7'
const tealSoft = '#DDF3F5'
const accentSoft = '#ECE9FB'
const good = '#12A150'

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

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
  // la fois le total (KPI) et la répartition par canal ci-dessous.
  const { data: activeAppointmentRows, error: appointmentsError } = await supabase
    .from('appointments')
    .select('acquisition_channel')
    .eq('client_id', profile.client_id)
    .eq('campaign_id', campaign.id)
    .eq('status', 'active')

  if (appointmentsError) {
    console.error(`Échec lecture rendez-vous campagne ${campaign.id} : ${appointmentsError.message}`)
  }

  const activeAppointments = activeAppointmentRows ?? []
  const channelBreakdown = groupByAcquisitionChannel(activeAppointments.map((a) => a.acquisition_channel))
  const realAppointmentsCount = realAppointments(activeAppointments.length, campaign.manual_appointments_adjustment)
  const realCostPerAppt = realCostPerAppointment(campaign.meta_spend, realAppointmentsCount)
  const trackingGapValue = trackingGap(realAppointmentsCount, campaign.meta_pixel_leads)

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
            'id, audience_id, name, impressions, video_plays, thruplays, video_p25, video_p50, video_p75, video_p100'
          )
          .in('audience_id', audienceIds)
      : { data: [] }

  const duration = campaignDurationDays(campaign.start_date, campaign.end_date)
  const costPerLead = costPerMetaPixelLead(campaign.meta_spend, campaign.meta_pixel_leads)

  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', fontFamily: 'sans-serif', color: ink }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
        <Link
          href="/dashboard"
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
          <h1 style={{ fontWeight: 600, fontSize: 23 }}>Campagne {campaign.campaign_number}</h1>
        </div>
        {campaign.status ? (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11.5,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 999,
              background: surfaceAlt,
              color: muted,
            }}
          >
            {campaign.status}
          </span>
        ) : null}
      </div>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 3 }}>
        {formatPeriod(campaign.start_date, campaign.end_date)}
        {duration !== null ? ` · ${duration} jour${duration > 1 ? 's' : ''}` : ''}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, margin: '20px 0' }}>
        <KpiCard label="Budget dépensé" color={spendColor} value={`${formatEur(campaign.meta_spend)} €`} />
        <KpiCard
          label="RDV confirmés"
          color={accent}
          value={String(realAppointmentsCount)}
          foot="rendez-vous Calendly rattachés"
        />
        <KpiCard label="Coût réel / RDV" color={ink} value={formatCost(realCostPerAppt)} foot="dépensé ÷ RDV Calendly" />
        <KpiCard
          label="Durée"
          color={good}
          value={duration !== null ? `${duration} j` : '—'}
          foot={duration === null ? 'non disponible' : undefined}
        />
        <KpiCard label="Leads Meta" color={accent} value={String(campaign.meta_pixel_leads)} foot="conversions pixel" />
        <KpiCard
          label="Coût / lead"
          color={ink}
          value={formatCost(costPerLead)}
          foot="dépensé ÷ leads Meta (pixel)"
        />
        {isAdmin ? (
          <KpiCard
            label="Écart de tracking"
            color={muted}
            value={String(trackingGapValue)}
            foot="RDV Calendly − leads Meta"
          />
        ) : null}
      </div>

      <div style={{ marginTop: 30, marginBottom: 14 }}>
        <h2 style={{ fontWeight: 600, fontSize: 17 }}>Rendez-vous par canal d&apos;acquisition</h2>
      </div>

      {channelBreakdown.length === 0 ? (
        <p style={{ color: muted }}>Aucun rendez-vous confirmé pour cette campagne.</p>
      ) : (
        <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr',
              gap: 14,
              padding: '10px 18px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '.05em',
              textTransform: 'uppercase',
              color: faint,
              background: surfaceAlt,
              borderBottom: `1px solid ${line}`,
            }}
          >
            <span>Canal</span>
            <span>Rendez-vous</span>
            <span>Part</span>
          </div>
          {channelBreakdown.map((row, index) => (
            <div
              key={row.channel}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 1fr',
                gap: 14,
                alignItems: 'center',
                padding: '12px 18px',
                borderTop: index === 0 ? 'none' : `1px solid ${line}`,
              }}
            >
              <span style={{ fontWeight: 500, fontSize: 14 }}>{row.channel}</span>
              <span style={{ fontWeight: 500, fontSize: 14 }}>{row.count}</span>
              <span style={{ fontWeight: 500, fontSize: 14 }}>{formatPct(row.ratio)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 30, marginBottom: 14 }}>
        <h2 style={{ fontWeight: 600, fontSize: 17 }}>Barbier vs Coiffeur</h2>
      </div>

      {(audiences ?? []).length === 0 ? (
        <p style={{ color: muted }}>Aucune audience disponible pour cette campagne.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {(audiences ?? []).map((audience) => {
            const video = (videos ?? []).find((v) => v.audience_id === audience.id) ?? null
            const audienceCostPerLead = costPerMetaPixelLead(audience.meta_spend, audience.meta_pixel_leads)
            const isBarbier = audience.audience_type === 'barbier'
            const badgeColor = isBarbier ? accent : teal
            const badgeSoft = isBarbier ? accentSoft : tealSoft

            const hookPlay = video ? hookRatePlay(video.video_plays, video.impressions) : null
            const hookThru = video ? hookRateThruplay(video.thruplays, video.impressions) : null
            const retention = video ? retentionRate(video.video_p100, video.video_p25) : null

            return (
              <div
                key={audience.id}
                style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}
              >
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
                    <div style={{ fontSize: 12.5, color: muted, marginTop: 12 }}>{video.name}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{video.impressions.toLocaleString('fr-FR')}</div>
                        <div style={{ fontSize: 10, color: muted, marginTop: 3 }}>Impressions</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{video.video_plays.toLocaleString('fr-FR')}</div>
                        <div style={{ fontSize: 10, color: muted, marginTop: 3 }}>Plays</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{video.thruplays.toLocaleString('fr-FR')}</div>
                        <div style={{ fontSize: 10, color: muted, marginTop: 3 }}>ThruPlays</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 13 }}>
                      <div style={{ flex: 1, textAlign: 'center', borderRadius: 10, padding: '8px 4px', background: surfaceAlt }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>{formatPct(hookPlay)}</div>
                        <div style={{ fontSize: 10, color: muted, marginTop: 3 }}>Accroche (play)</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', borderRadius: 10, padding: '8px 4px', background: surfaceAlt }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>{formatPct(hookThru)}</div>
                        <div style={{ fontSize: 10, color: muted, marginTop: 3 }}>Accroche (thruplay)</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', borderRadius: 10, padding: '8px 4px', background: surfaceAlt }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>{formatPct(retention)}</div>
                        <div style={{ fontSize: 10, color: muted, marginTop: 3 }}>Rétention</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p style={{ color: muted, fontSize: 12.5, marginTop: 12 }}>Aucune vidéo disponible.</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
