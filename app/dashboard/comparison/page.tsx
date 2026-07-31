import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  campaignDurationDays,
  costPerMetaPixelLead,
  hookRatePlay,
  metaPixelLeadsPerDay,
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

function formatLeadsPerDay(n: number | null): string {
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
      .select('id, campaign_number, start_date, end_date, meta_spend, meta_pixel_leads')
      .eq('client_id', profile.client_id)
      .order('campaign_number', { ascending: true })

    if (campaignError) {
      loadError = campaignError.message
    } else {
      campaigns = campaignData ?? []

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

  // Comparatif campagnes : durée, leads Meta, leads/jour, dépensé, coût/lead.
  const comparisonRows = campaigns.map((campaign) => {
    const duration = campaignDurationDays(campaign.start_date, campaign.end_date)
    return {
      campaign,
      duration,
      leadsPerDay: metaPixelLeadsPerDay(campaign.meta_pixel_leads, duration),
      costPerLead: costPerMetaPixelLead(campaign.meta_spend, campaign.meta_pixel_leads),
    }
  })

  // Mis en avant uniquement sur les métriques de performance comparables entre
  // campagnes (taux, coût) — pas sur les totaux bruts (dépensé, leads Meta),
  // qui ne sont pas comparables sans normalisation. Même principe que la
  // maquette (RDV/jour et coût/RDV uniquement surlignés).
  const bestLeadsPerDay = Math.max(
    ...comparisonRows.map((r) => r.leadsPerDay).filter((v): v is number => v !== null)
  )
  const bestCostPerLead = Math.min(
    ...comparisonRows.map((r) => r.costPerLead).filter((v): v is number => v !== null)
  )
  const hasBestLeadsPerDay = Number.isFinite(bestLeadsPerDay)
  const hasBestCostPerLead = Number.isFinite(bestCostPerLead)

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
                  {['Campagne', 'Durée', 'Leads Meta', 'Leads / j', 'Dépensé', 'Coût / lead'].map((label) => (
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
                  const isBestLeadsPerDay = hasBestLeadsPerDay && row.leadsPerDay === bestLeadsPerDay
                  const isBestCostPerLead = hasBestCostPerLead && row.costPerLead === bestCostPerLead
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
                        {row.campaign.meta_pixel_leads}
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right' }}>
                        {formatLeadsPerDay(row.leadsPerDay)}
                        {isBestLeadsPerDay ? <span style={{ color: '#12A150', fontSize: 11, fontWeight: 600, marginLeft: 6 }}>top</span> : null}
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right' }}>
                        {formatEur(row.campaign.meta_spend)} €
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, borderTop: `1px solid ${line}`, textAlign: 'right' }}>
                        {formatCost(row.costPerLead)}
                        {isBestCostPerLead ? <span style={{ color: '#12A150', fontSize: 11, fontWeight: 600, marginLeft: 6 }}>top</span> : null}
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
