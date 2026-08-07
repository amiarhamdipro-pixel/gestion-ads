import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logger'
import {
  campaignDurationDays,
  costPerMetaPixelLead,
  hookRate,
  isDateRangePreset,
  parisDateFromInstant,
  realAppointments,
  realCostPerAppointment,
  resolveDateRange,
  retentionRate,
  trackingGap,
} from '@/lib/calculations'
import { buildDateRangeQueryString } from '@/lib/dateRangeQuery'
// POC miniature réelle (campagne n°20 uniquement, voir plus bas) : lecture
// seule, jamais de synchro/écriture déclenchée depuis cette page.
import { fetchVideoThumbnailForAd } from '@/lib/sync/meta'
import KpiCard from '../../KpiCard'
import PublishToggle from '../../PublishToggle'
import VideoThumbnail from './VideoThumbnail'
import {
  amber,
  facebookBlue,
  faint,
  formatCost,
  formatEur,
  formatPeriod,
  gray,
  green,
  headerBg,
  indigo,
  ink,
  instagramMagenta,
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

// Priorité d'affichage du nom vidéo (voir BRIEF-CLAUDE-CODE.md) :
// video_display_name (nom réel du fichier importé dans Meta) -> videos.name
// (nom de la pub Ads Manager) -> repli générique. Jamais d'erreur, jamais de
// placeholder technique.
function videoDisplayName(video: { video_display_name: string | null; name: string }): string {
  return video.video_display_name?.trim() || video.name.trim() || 'Vidéo'
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

// Tranches d'âge Meta réellement stockées (appointment_breakdowns, voir
// lib/sync/mapper.ts, mapAgeInsightsToBreakdownInsert — age_55_plus regroupe
// les tranches Meta 55-64 et 65+). Ordre chronologique fixe (pas trié par
// volume, contrairement au canal d'acquisition) : plus lisible pour une
// donnée intrinsèquement ordonnée. Réutilise le type ChannelBreakdown (même
// forme : label/count/ratio) et CHANNEL_COLORS ci-dessus (5 tranches ≤ 6
// couleurs), sans dupliquer de logique de rendu.
const AGE_BUCKETS = [
  { key: 'age_18_24', label: '18-24 ans' },
  { key: 'age_25_34', label: '25-34 ans' },
  { key: 'age_35_44', label: '35-44 ans' },
  { key: 'age_45_54', label: '45-54 ans' },
  { key: 'age_55_plus', label: '55 ans et +' },
] as const

type AgeBreakdownRow = Pick<
  Record<(typeof AGE_BUCKETS)[number]['key'], number>,
  (typeof AGE_BUCKETS)[number]['key']
>

// Leads Meta dont l'âge n'est pas déterminable ("Unknown" côté Meta) n'ont
// pas de colonne dédiée (voir lib/sync/mapper.ts) : exclus du total, jamais
// répartis arbitrairement sur les tranches connues — la somme des tranches
// affichées peut donc être inférieure aux leads Meta totaux de la campagne,
// honnêtement (pas un bug).
function buildAgeBreakdown(row: AgeBreakdownRow | null): ChannelBreakdown[] {
  if (!row) return []
  const total = AGE_BUCKETS.reduce((sum, bucket) => sum + row[bucket.key], 0)
  if (total === 0) return []
  return AGE_BUCKETS.filter((bucket) => row[bucket.key] > 0).map((bucket) => ({
    channel: bucket.label,
    count: row[bucket.key],
    ratio: row[bucket.key] / total,
  }))
}

// Répartition des leads par genre x tranche d'âge, AU NIVEAU DE L'AUDIENCE
// (Barbier/Coiffeur séparément) — donnée de l'import historique Excel
// uniquement (migration 20260809000000), jamais renseignée par la synchro
// Meta réelle. Distincte de AGE_BUCKETS/buildAgeBreakdown ci-dessus, qui
// reste au niveau CAMPAGNE, sans genre, et avec un palier "55 et +" que ces
// 4 tranches n'ont pas — les deux sources ne se recouvrent jamais, jamais
// fusionnées.
const AUDIENCE_AGE_GENDER_BUCKETS = [
  { key: 'leads_male_18_24', label: 'H 18-24' },
  { key: 'leads_male_25_34', label: 'H 25-34' },
  { key: 'leads_male_35_44', label: 'H 35-44' },
  { key: 'leads_male_45_54', label: 'H 45-54' },
  { key: 'leads_female_18_24', label: 'F 18-24' },
  { key: 'leads_female_25_34', label: 'F 25-34' },
  { key: 'leads_female_35_44', label: 'F 35-44' },
  { key: 'leads_female_45_54', label: 'F 45-54' },
] as const

type DonutSegment = { color: string; dasharray: string; dashoffset: number }

// Couleur d'une ligne donnée (donut + légende) : Facebook/Instagram reçoivent
// toujours leur couleur de marque dédiée (voir format.ts), quel que soit leur
// rang dans la liste — jamais une couleur de la rotation générique
// CHANNEL_COLORS pour ces deux-là (avant, elles héritaient d'indigo/violet,
// deux teintes trop proches pour être distinguées au premier coup d'œil).
// Tout autre canal réel (Google, Tiktok, MCB, "Non renseigné"...) ou toute
// autre donnée réutilisant ce même donut (répartition par tranche d'âge)
// continue de piocher dans CHANNEL_COLORS par position, comportement
// inchangé.
function channelColor(label: string, fallbackIndex: number): string {
  const normalized = label.trim().toLowerCase()
  if (normalized.startsWith('facebook')) return facebookBlue
  if (normalized.startsWith('instagram')) return instagramMagenta
  return CHANNEL_COLORS[fallbackIndex % CHANNEL_COLORS.length]
}

function donutSegments(rows: ChannelBreakdown[], donutTotal: number, radiusPx: number): DonutSegment[] {
  const circumference = 2 * Math.PI * radiusPx
  let cumulative = 0
  return rows.map((row, i) => {
    const fraction = donutTotal > 0 ? row.count / donutTotal : 0
    const dash = fraction * circumference
    const segment: DonutSegment = {
      color: channelColor(row.channel, i),
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
    .select(
      'id, campaign_number, start_date, end_date, status, published, sync_locked, meta_spend, meta_pixel_leads, manual_appointments_adjustment'
    )
    .eq('id', id)
    .eq('client_id', profile.client_id)
    .maybeSingle()

  if (!campaign) {
    notFound()
  }

  // État de publication (indépendant du statut Meta) : un client ne peut pas
  // accéder directement par URL à une campagne non publiée (même règle que
  // les listes, voir app/dashboard/page.tsx et comparison/page.tsx — la
  // campagne n'apparaît déjà plus dans aucun lien qui y mènerait, ceci
  // couvre l'accès direct). L'admin accède à tout, y compris les campagnes
  // non publiées.
  if (!isAdmin && !campaign.published) {
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

  // Chargée ici (avant le donut ci-dessous) car nécessaire aux deux : le
  // donut Facebook/Instagram d'une campagne historique en dérive
  // directement (facebook_leads/instagram_leads), voir plus bas.
  const { data: audiences } = await supabase
    .from('audiences')
    .select(
      'id, audience_type, name, meta_spend, meta_pixel_leads, facebook_leads, instagram_leads, leads_male_18_24, leads_male_25_34, leads_male_35_44, leads_male_45_54, leads_female_18_24, leads_female_25_34, leads_female_35_44, leads_female_45_54'
    )
    .eq('campaign_id', campaign.id)
    .order('audience_type', { ascending: true })

  const audienceIds = (audiences ?? []).map((a) => a.id)

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

  // Campagne historique verrouillée : aucun rendez-vous Calendly réel n'est
  // jamais rattaché (voir BRIEF-CLAUDE-CODE.md), donc channelBreakdown serait
  // toujours vide et le donut ne montrerait que l'ajustement manuel — plus
  // représentatif ni utile. Remplacé par la répartition Facebook/Instagram
  // réellement fournie par le fichier Excel, au niveau audience
  // (Facebook Barber+Coiffeur / Instagram Barber+Coiffeur), jamais
  // "Ajustement manuel" pour ces campagnes. Campagne dynamique : logique
  // canal d'acquisition réelle inchangée.
  const channelBreakdown = campaign.sync_locked
    ? (() => {
        const facebook = (audiences ?? []).reduce((sum, a) => sum + (a.facebook_leads ?? 0), 0)
        const instagram = (audiences ?? []).reduce((sum, a) => sum + (a.instagram_leads ?? 0), 0)
        const rows: ChannelBreakdown[] = []
        const total = facebook + instagram
        if (total > 0 && facebook > 0) rows.push({ channel: 'Facebook', count: facebook, ratio: facebook / total })
        if (total > 0 && instagram > 0) rows.push({ channel: 'Instagram', count: instagram, ratio: instagram / total })
        return rows
      })()
    : groupByAcquisitionChannel(channelSourceAppointments.map((a) => a.acquisition_channel))

  // manual_appointments_adjustment est un correctif global à la campagne,
  // sans date ni canal associés — jamais appliqué à une période (même règle
  // qu'ailleurs, voir BRIEF-CLAUDE-CODE.md), et jamais affiché pour une
  // campagne historique (le donut n'y montre plus que Facebook/Instagram,
  // voir ci-dessus). Uniquement pertinent hors période pour une campagne
  // dynamique, où le KPI "RDV confirmés" l'inclut : affiché comme ligne à
  // part (jamais fondu dans un canal réel) pour que la somme du détail reste
  // strictement égale au KPI.
  const manualAdjustmentForBreakdown = campaign.sync_locked || resolvedRange ? 0 : campaign.manual_appointments_adjustment
  const channelTotal = channelBreakdown.reduce((sum, row) => sum + row.count, 0)
  const breakdownGrandTotal = channelTotal + manualAdjustmentForBreakdown

  // Répartition des leads Meta par tranche d'âge : UNIQUEMENT pour une
  // campagne dynamique (appointment_breakdowns est une table alimentée par
  // la synchro Meta réelle, lib/sync/syncCampaign.ts — jamais appelée pour
  // une campagne verrouillée, voir BRIEF-CLAUDE-CODE.md). Pour une campagne
  // historique, la répartition par âge existe déjà, à un niveau plus
  // précis (par audience x genre), affichée dans chaque carte Barbier/
  // Coiffeur ci-dessous — cette table n'est ni interrogée ni utilisée ici
  // pour elles.
  const { data: ageBreakdownRow } = campaign.sync_locked
    ? { data: null }
    : await supabase
        .from('appointment_breakdowns')
        .select('age_18_24, age_25_34, age_35_44, age_45_54, age_55_plus')
        .eq('campaign_id', campaign.id)
        .maybeSingle()

  const ageBreakdown = buildAgeBreakdown(ageBreakdownRow)
  const ageBreakdownTotal = ageBreakdown.reduce((sum, row) => sum + row.count, 0)

  const { data: videos } =
    audienceIds.length > 0
      ? await supabase
          .from('videos')
          .select(
            'id, audience_id, meta_ad_id, name, video_display_name, impressions, video_plays, video_plays_3s, average_watch_time_seconds, video_p25, video_p50, video_p75, video_p100, hook_rate_pct, retention_rate_pct'
          )
          .in('audience_id', audienceIds)
      : { data: [] }

  // POC miniature réelle (campagne n°20 uniquement, voir BRIEF-CLAUDE-CODE.md) :
  // récupérée en direct depuis Meta à chaque affichage de la page, jamais
  // persistée en base (URLs Meta signées et temporaires — voir
  // lib/sync/types.ts, MetaVideoPicture). Aucun impact sur les campagnes
  // historiques (1 à 19) ni sur les futures campagnes dynamiques (21+) :
  // strictement gardé par campaign_number === 20, jamais un seuil générique.
  // videoThumbnails[video.id] === undefined -> non tenté (hors campagne 20) ;
  // null -> tenté mais échoué/absent ; string -> URL récupérée. Dans les deux
  // premiers cas, la carte affiche le placeholder existant (VideoThumbnail
  // n'est monté que si l'URL est une chaîne non vide).
  const videoThumbnails: Record<string, string | null> = {}
  if (campaign.campaign_number === 20) {
    const resolved = await Promise.all(
      (videos ?? []).map(async (v) => [v.id, await fetchVideoThumbnailForAd(v.meta_ad_id)] as const)
    )
    for (const [videoId, url] of resolved) videoThumbnails[videoId] = url
  }

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
        .amerys-age-gender-grid { grid-template-columns: repeat(4, 1fr); }
        @media (max-width: 480px) {
          .amerys-age-gender-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4, flexWrap: 'wrap' }}>
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
            style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: muted }}
          >
            Détail campagne
          </div>
          <h1 style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-.01em' }}>Campagne {campaign.campaign_number}</h1>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* État sync_locked (règle métier officielle, voir
              BRIEF-CLAUDE-CODE.md) : "Validée" = verrouillée définitivement,
              plus jamais synchronisée — jamais "Synchronisable", qui
              suggérerait à tort qu'une action de synchro reste possible.
              Indépendant de published (visibilité client), affiché aux deux
              rôles comme campaign.status ci-dessous. */}
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 999,
              background: campaign.sync_locked ? softBg(indigo, 0.14) : softBg(green, 0.14),
              color: ink,
            }}
          >
            {campaign.sync_locked ? '🔒 Validée' : '🟢 En préparation'}
          </span>
          {campaign.status ? (
            <span
              style={{
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
      </div>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 4 }}>
        {resolvedRange
          ? formatPeriod(resolvedRange.start, resolvedRange.end)
          : formatPeriod(campaign.start_date, campaign.end_date)}
        {!resolvedRange && duration !== null ? ` · ${duration} jour${duration > 1 ? 's' : ''}` : ''}
      </p>
      {/* Workflow complet réalisable depuis cette page (voir
          BRIEF-CLAUDE-CODE.md) : Synchroniser (bouton global, en-tête du
          dashboard) -> Contrôler (données ci-dessous) -> Publier (ici).
          Admin uniquement, même règle que la liste des campagnes
          (OverviewSection.tsx). */}
      {isAdmin ? (
        <div style={{ marginTop: 10 }}>
          <PublishToggle campaignId={campaign.id} initialPublished={campaign.published} />
        </div>
      ) : null}

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
        {isAdmin ? (
          <KpiCard
            icon={<TrendingUpIcon size={20} />}
            iconColor={gray}
            iconBg={softBg(gray, 0.12)}
            label="Leads Meta"
            value={String(metaPixelLeadsForKpis)}
            foot="conversions pixel"
          />
        ) : null}
        {isAdmin ? (
          <KpiCard
            icon={<DollarIcon size={20} />}
            iconColor={gray}
            iconBg={softBg(gray, 0.12)}
            label="Coût / lead"
            value={formatCost(costPerLead)}
            foot="dépensé ÷ leads Meta (pixel)"
          />
        ) : null}
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
        <h2 style={{ fontWeight: 700, fontSize: 17 }}>
          {campaign.sync_locked ? 'Leads par plateforme (Facebook / Instagram)' : "Rendez-vous par canal d'acquisition"}
        </h2>
      </div>

      {breakdownGrandTotal === 0 ? (
        <p style={{ color: muted }}>
          {campaign.sync_locked
            ? 'Aucune donnée Facebook/Instagram pour cette campagne.'
            : `Aucun rendez-vous confirmé pour cette campagne${resolvedRange ? ' sur cette période' : ''}.`}
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
          <svg
            width={140}
            height={140}
            viewBox="0 0 140 140"
            style={{ flexShrink: 0 }}
            role="img"
            aria-label={
              campaign.sync_locked
                ? `${channelTotal} leads répartis par plateforme`
                : `${channelTotal} rendez-vous répartis par canal d'acquisition`
            }
          >
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
              {campaign.sync_locked ? 'leads' : 'RDV'}
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
                    background: channelColor(row.channel, i),
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

      {/* Répartition par tranche d'âge (appointment_breakdowns, niveau
          campagne) : UNIQUEMENT pour une campagne dynamique — voir le
          commentaire sur ageBreakdownRow plus haut. Pour une campagne
          historique, cette table n'est ni interrogée ni affichée ; la
          répartition par âge existe déjà, plus précise (par audience x
          genre), dans chaque carte Barbier/Coiffeur ci-dessous. */}
      {!campaign.sync_locked ? (
        <>
          <div style={{ marginTop: 32, marginBottom: 16 }}>
            <h2 style={{ fontWeight: 700, fontSize: 17 }}>
              Répartition des leads Meta par tranche d&apos;âge
              {resolvedRange ? (
                <span style={{ fontWeight: 600, fontSize: 12.5, color: muted, marginLeft: 8 }}>(total campagne)</span>
              ) : null}
            </h2>
            {resolvedRange ? (
              <p style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
                Pas de détail journalier par tranche d&apos;âge — ces chiffres portent sur toute la durée de la
                campagne, pas sur la période sélectionnée.
              </p>
            ) : null}
          </div>

          {ageBreakdownTotal === 0 ? (
            <p style={{ color: muted }}>Aucun lead Meta avec tranche d&apos;âge connue pour cette campagne.</p>
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
              <svg width={140} height={140} viewBox="0 0 140 140" style={{ flexShrink: 0 }} role="img" aria-label={`${ageBreakdownTotal} leads Meta répartis par tranche d'âge`}>
                <circle cx={70} cy={70} r={54} fill="none" stroke={surfaceAlt} strokeWidth={18} />
                {donutSegments(ageBreakdown, ageBreakdownTotal, 54).map((seg, i) => (
                  <circle
                    key={ageBreakdown[i].channel}
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
                  {ageBreakdownTotal}
                </text>
                <text x={70} y={83} textAnchor="middle" fontSize={11} fill={muted}>
                  leads
                </text>
              </svg>

              <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ageBreakdown.map((row, i) => (
                  <div key={row.channel} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: channelColor(row.channel, i),
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{row.channel}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{row.count}</span>
                    <span style={{ fontSize: 12.5, color: muted, minWidth: 50, textAlign: 'right' }}>
                      {formatPct(row.count / ageBreakdownTotal)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      <div style={{ marginTop: 32, marginBottom: 16 }}>
        <h2 style={{ fontWeight: 700, fontSize: 17 }}>
          Barbier vs Coiffeur
          {resolvedRange ? (
            <span style={{ fontWeight: 600, fontSize: 12.5, color: muted, marginLeft: 8 }}>(total campagne)</span>
          ) : null}
        </h2>
        {resolvedRange ? (
          <p style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
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

              // Priorité d'affichage des taux vidéo (voir BRIEF-CLAUDE-CODE.md) :
              // campagne historique verrouillée (sync_locked=true) avec un
              // taux importé du fichier Excel -> ce taux est la référence,
              // même si d'anciens compteurs Meta bruts sont encore stockés
              // (campagne n°12 : jamais recalculé depuis impressions/
              // video_plays_3s/video_p100, qui restent en base mais ne
              // priment plus visuellement). Sinon -> calcul réel à partir des
              // compteurs bruts s'ils existent. Sinon -> "—" (aucune donnée).
              const hook =
                campaign.sync_locked && video?.hook_rate_pct != null
                  ? video.hook_rate_pct
                  : video && video.video_plays_3s !== null && video.impressions !== null
                    ? hookRate(video.video_plays_3s, video.impressions)
                    : null
              const retention =
                campaign.sync_locked && video?.retention_rate_pct != null
                  ? video.retention_rate_pct
                  : video && video.video_p100 !== null && video.video_plays_3s !== null
                    ? retentionRate(video.video_p100, video.video_plays_3s)
                    : null

              // POC campagne n°20 uniquement (voir videoThumbnails plus
              // haut) : chaîne = URL réelle récupérée, sinon null (hors
              // campagne 20, échec Meta, ou pas de vidéo) -> placeholder.
              const thumbnailUrl = video ? (videoThumbnails[video.id] ?? null) : null

              return (
                <div
                  key={audience.id}
                  style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}
                >
                  {/* Vignette vidéo : placeholder sobre par défaut (fond
                      sombre + icône Play, purement décorative, pas de
                      lecture réelle). POC campagne n°20 (voir
                      videoThumbnails plus haut, lib/sync/meta.ts) : vraie
                      miniature Meta affichée par-dessus quand thumbnailUrl
                      est une URL récupérée avec succès — VideoThumbnail
                      (Client Component) bascule silencieusement vers rien
                      (donc ce même placeholder) si l'image échoue à charger
                      côté navigateur, jamais une image cassée. Prêt pour un
                      futur champ persistant videos.thumbnail_url (jamais
                      créé/stocké ici) : il suffira de faire pointer
                      thumbnailUrl dessus au lieu du fetch Meta en direct,
                      aucune autre partie de la carte à modifier. Nom vidéo
                      et audience ne sont volontairement PAS incrustés sur
                      l'image (texte en dessous à la place) : un nom de
                      fichier peut être long et une vraie photo,
                      imprévisible — un texte flottant sur un dégradé ne
                      garantit pas un contraste correct dans tous les cas,
                      contrairement à du texte ordinaire sur fond de carte. */}
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
                    {thumbnailUrl ? (
                      <VideoThumbnail src={thumbnailUrl} alt={video ? videoDisplayName(video) : ''} />
                    ) : null}
                    <PlayIcon
                      size={40}
                      style={{ color: video ? onDark : onDarkMuted, position: 'relative', zIndex: 1 }}
                    />
                    {video ? (
                      <>
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
                            zIndex: 1,
                          }}
                        >
                          {video.video_plays.toLocaleString('fr-FR')} vues
                        </span>
                        {isAdmin && isBestCostPerLead ? (
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
                              // color: ink, pas onDark (blanc) — blanc sur
                              // vert plein ne passe pas un contraste
                              // suffisant (~2,5:1) ; ink y reste très lisible
                              // (~7:1).
                              color: ink,
                              zIndex: 1,
                            }}
                          >
                            Meilleur coût/lead
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    {video ? (
                      <>
                        {/* Nom vidéo (prioritaire) : voir videoDisplayName
                            ci-dessus. Nom de la pub Meta conservé visible
                            mais secondaire — seulement s'il diffère
                            réellement du libellé principal (sinon doublon
                            visuel : quand video_display_name est absent,
                            videoDisplayName retombe déjà sur video.name, les
                            deux lignes seraient identiques). Texte normal
                            (pas incrusté sur l'image) : un nom de fichier
                            long passe simplement à la ligne, jamais coupé de
                            façon incompréhensible. */}
                        <div style={{ fontWeight: 700, fontSize: 14.5, color: ink, wordBreak: 'break-word' }}>
                          {videoDisplayName(video)}
                        </div>
                        {video.name !== videoDisplayName(video) ? (
                          <div style={{ fontSize: 11, color: muted, marginTop: 2, wordBreak: 'break-word' }}>
                            {video.name}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: muted }}>Aucune vidéo disponible</div>
                    )}
                    <div style={{ marginTop: 8 }}>
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
                        Audience : {isBarbier ? 'Barbier' : 'Coiffeur'}
                      </span>
                    </div>
                  </div>

                  <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${isAdmin ? 3 : 1}, 1fr)`,
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
                  {isAdmin ? (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: 16 }}>{audience.meta_pixel_leads}</div>
                      <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Leads Meta</div>
                    </div>
                  ) : null}
                  {isAdmin ? (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: 16 }}>{formatCost(audienceCostPerLead)}</div>
                      <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Coût/lead</div>
                    </div>
                  ) : null}
                </div>

                {/* Répartition des leads par plateforme : donnée de l'import
                    historique Excel uniquement (voir types/database.ts,
                    Audience) — absente (donc masquée) pour toute audience
                    réellement synchronisée via Meta. Mêmes couleurs de
                    marque que le donut/la légende plus haut (facebookBlue/
                    instagramMagenta, voir format.ts) — texte toujours en
                    `ink` sur fond softBg() pâle, jamais la teinte brute
                    comme couleur de texte. */}
                {audience.facebook_leads !== null || audience.instagram_leads !== null ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: ink,
                        background: softBg(facebookBlue, 0.12),
                        borderRadius: 999,
                        padding: '3px 9px',
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: facebookBlue, flexShrink: 0 }} />
                      Facebook {audience.facebook_leads ?? '—'}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: ink,
                        background: softBg(instagramMagenta, 0.12),
                        borderRadius: 999,
                        padding: '3px 9px',
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: instagramMagenta, flexShrink: 0 }} />
                      Instagram {audience.instagram_leads ?? '—'}
                    </span>
                  </div>
                ) : null}

                {/* Répartition des leads par genre x tranche d'âge — import
                    historique Excel uniquement (voir AUDIENCE_AGE_GENDER_BUCKETS
                    ci-dessus) ; jamais affiché pour une audience réellement
                    synchronisée via Meta (toutes les valeurs restent null). */}
                {AUDIENCE_AGE_GENDER_BUCKETS.some(({ key }) => audience[key] !== null) ? (
                  <div style={{ marginTop: 8 }}>
                    <p
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '.04em',
                        textTransform: 'uppercase',
                        color: muted,
                        textAlign: 'center',
                        marginBottom: 4,
                      }}
                    >
                      Leads par âge et genre
                    </p>
                    <div
                      className="amerys-age-gender-grid"
                      style={{
                        display: 'grid',
                        gap: 6,
                        fontSize: 11.5,
                        color: muted,
                        textAlign: 'center',
                      }}
                    >
                      {AUDIENCE_AGE_GENDER_BUCKETS.map(({ key, label }) => (
                        <span key={key}>
                          {label} : {audience[key] ?? '—'}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {video ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>{video.video_plays.toLocaleString('fr-FR')}</div>
                        <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Nombre de vues</div>
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
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{formatPct(hook)}</div>
                        <div style={{ fontSize: 10.5, color: muted, marginTop: 4 }}>Accroche</div>
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
