import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  appointmentsPerDay,
  campaignDurationDays,
  costPerMetaPixelLead,
  hookRatePlay,
  realAppointments,
  realCostPerAppointment,
} from '@/lib/calculations'
import { accent, faint, formatCost, formatEur, ink, line, muted, surfaceAlt } from '../format'
import VideoRanking, { type RankedVideo } from './VideoRanking'

type CampaignRow = {
  id: string
  campaign_number: number
  start_date: string | null
  end_date: string | null
  meta_spend: number
  meta_pixel_leads: number
  manual_appointments_adjustment: number
  calendlyAppointments: number
}

type AudienceRow = {
  id: string
  campaign_id: string
  audience_type: 'barbier' | 'coiffeur'
  meta_spend: number
  meta_pixel_leads: number
}

type VideoRow = {
  audience_id: string
  meta_ad_id: string
  name: string
  impressions: number
  video_plays: number
}

function formatDuration(days: number | null): string {
  return days === null ? '—' : `${days} j`
}

function formatPerDay(n: number | null): string {
  return n === null ? '—' : n.toFixed(2).replace('.', ',')
}

export default async function ComparisonPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', user.id).maybeSingle()

  let campaigns: CampaignRow[] = []
  let audiences: AudienceRow[] = []
  let videos: VideoRow[] = []
  let loadError: string | null = null

  if (profile?.client_id) {
    const { data: campaignData, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, campaign_number, start_date, end_date, meta_spend, meta_pixel_leads, manual_appointments_adjustment')
      .eq('client_id', profile.client_id)
      .order('campaign_number', { ascending: true })

    if (campaignError) {
      loadError = campaignError.message
    } else {
      const loadedCampaigns = campaignData ?? []
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
            console.error(`Échec comptage rendez-vous campagne ${c.id} : ${countError.message}`)
          }
          return count ?? 0
        })
      )
      campaigns = loadedCampaigns.map((c, i) => ({ ...c, calendlyAppointments: counts[i] }))

      if (campaigns.length > 0) {
        const { data: audienceData, error: audienceError } = await supabase
          .from('audiences')
          .select('id, campaign_id, audience_type, meta_spend, meta_pixel_leads')
          .in(
            'campaign_id',
            campaigns.map((c) => c.id)
          )

        if (audienceError) {
          loadError = audienceError.message
        } else {
          audiences = audienceData ?? []

          if (audiences.length > 0) {
            const { data: videoData, error: videoError } = await supabase
              .from('videos')
              .select('audience_id, meta_ad_id, name, impressions, video_plays')
              .in(
                'audience_id',
                audiences.map((a) => a.id)
              )

            if (videoError) {
              loadError = videoError.message
            } else {
              videos = videoData ?? []
            }
          }
        }
      }
    }
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

  // Classement vidéos : agrège par meta_ad_id (une vidéo réelle peut revenir
  // sur plusieurs campagnes) ; sinon une ligne par vidéo. Coût/lead et
  // accroche recalculés sur les totaux agrégés (jamais sur des moyennes de
  // ratios, pour rester exact).
  const audienceById = new Map(audiences.map((a) => [a.id, a]))
  const campaignByAudienceId = new Map(audiences.map((a) => [a.id, a.campaign_id]))
  const campaignNumberById = new Map(campaigns.map((c) => [c.id, c.campaign_number]))

  type VideoGroup = {
    metaAdId: string
    name: string
    audienceType: 'barbier' | 'coiffeur'
    campaignNumbers: Set<number>
    totalImpressions: number
    totalPlays: number
    totalSpend: number
    totalLeads: number
  }

  const groups = new Map<string, VideoGroup>()
  for (const video of videos) {
    const audience = audienceById.get(video.audience_id)
    if (!audience) continue

    const existing = groups.get(video.meta_ad_id)
    const campaignId = campaignByAudienceId.get(video.audience_id)
    const campaignNumber = campaignId ? campaignNumberById.get(campaignId) : undefined

    if (existing) {
      existing.totalImpressions += video.impressions
      existing.totalPlays += video.video_plays
      existing.totalSpend += audience.meta_spend
      existing.totalLeads += audience.meta_pixel_leads
      if (campaignNumber !== undefined) existing.campaignNumbers.add(campaignNumber)
    } else {
      groups.set(video.meta_ad_id, {
        metaAdId: video.meta_ad_id,
        name: video.name,
        audienceType: audience.audience_type,
        campaignNumbers: new Set(campaignNumber !== undefined ? [campaignNumber] : []),
        totalImpressions: video.impressions,
        totalPlays: video.video_plays,
        totalSpend: audience.meta_spend,
        totalLeads: audience.meta_pixel_leads,
      })
    }
  }

  const rankedVideos: RankedVideo[] = Array.from(groups.values()).map((g) => ({
    metaAdId: g.metaAdId,
    name: g.name,
    campaignCount: g.campaignNumbers.size,
    audienceType: g.audienceType,
    costPerLead: costPerMetaPixelLead(g.totalSpend, g.totalLeads),
    hookPlay: hookRatePlay(g.totalPlays, g.totalImpressions),
  }))

  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', fontFamily: 'sans-serif', color: ink }}>
      <Link href="/dashboard" style={{ fontSize: 12.5, color: muted, textDecoration: 'none' }}>
        ← Vue d&apos;ensemble
      </Link>
      <h1 style={{ fontWeight: 600, fontSize: 23, marginTop: 8 }}>Comparaison</h1>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 3 }}>Toutes les campagnes ramenées à armes égales</p>

      {!profile?.client_id ? (
        <p style={{ marginTop: 20, color: muted }}>Aucun client associé à ce compte.</p>
      ) : loadError ? (
        <p style={{ marginTop: 20, color: '#D93A3A' }}>Impossible de charger les données pour le moment. Réessayez plus tard.</p>
      ) : campaigns.length === 0 ? (
        <p style={{ marginTop: 20, color: muted }}>Aucune campagne synchronisée pour le moment.</p>
      ) : (
        <>
          <div style={{ marginTop: 24, marginBottom: 14 }}>
            <h2 style={{ fontWeight: 600, fontSize: 17 }}>Campagnes côte à côte</h2>
            <p style={{ color: faint, fontSize: 12.5, marginTop: 2 }}>
              La meilleure valeur de chaque colonne comparable est mise en avant
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {['Campagne', 'Durée', 'RDV Calendly', 'RDV / j', 'Dépensé', 'Coût réel / RDV', 'Leads Meta'].map((label) => (
                    <th
                      key={label}
                      style={{
                        textAlign: label === 'Campagne' ? 'left' : 'right',
                        padding: '13px 14px',
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '.04em',
                        textTransform: 'uppercase',
                        color: faint,
                        background: surfaceAlt,
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => {
                  const isBestAppointmentsPerDay =
                    hasBestAppointmentsPerDay && row.appointmentsPerDayValue === bestAppointmentsPerDay
                  const isBestRealCostPerAppointment =
                    hasBestRealCostPerAppointment && row.realCostPerAppt === bestRealCostPerAppointment
                  return (
                    <tr key={row.campaign.id}>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, fontWeight: 600 }}>
                        <Link href={`/dashboard/campaigns/${row.campaign.id}`} style={{ color: accent, textDecoration: 'none' }}>
                          Campagne {row.campaign.campaign_number}
                        </Link>
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right' }}>
                        {formatDuration(row.duration)}
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right' }}>
                        {row.realCount}
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right' }}>
                        {formatPerDay(row.appointmentsPerDayValue)}
                        {isBestAppointmentsPerDay ? (
                          <span style={{ color: '#12A150', fontSize: 11, fontWeight: 600, marginLeft: 6 }}>top</span>
                        ) : null}
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right' }}>
                        {formatEur(row.campaign.meta_spend)} €
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right' }}>
                        {formatCost(row.realCostPerAppt)}
                        {isBestRealCostPerAppointment ? (
                          <span style={{ color: '#12A150', fontSize: 11, fontWeight: 600, marginLeft: 6 }}>top</span>
                        ) : null}
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right', color: faint }}>
                        {row.campaign.meta_pixel_leads}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 30, marginBottom: 14 }}>
            <h2 style={{ fontWeight: 600, fontSize: 17 }}>Classement des vidéos</h2>
            <p style={{ color: faint, fontSize: 12.5, marginTop: 2 }}>
              {rankedVideos.length} vidéo{rankedVideos.length > 1 ? 's' : ''} — une vidéo peut revenir sur plusieurs
              campagnes
            </p>
          </div>

          <VideoRanking videos={rankedVideos} />
        </>
      )}
    </main>
  )
}
