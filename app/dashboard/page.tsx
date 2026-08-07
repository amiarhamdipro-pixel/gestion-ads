import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  enumerateDateRange,
  isDateRangePreset,
  realAppointments,
  realCostPerAppointment,
  resolveDateRange,
} from '@/lib/calculations'
import { buildDateRangeQueryString } from '@/lib/dateRangeQuery'
import { logError } from '@/lib/logger'
import OverviewSection from './OverviewSection'
import OverviewDailyChart, { type DailyPoint } from './OverviewDailyChart'
import KpiCard from './KpiCard'
import EmptyPeriodState from './EmptyPeriodState'
import {
  accent,
  amber,
  formatCost,
  formatEur,
  formatPeriod,
  indigo,
  lavender,
  line,
  muted,
  radius,
  softBg,
  surface,
  surfaceAlt,
  violet,
} from './format'
import { CalendarIcon, DollarIcon, UserIcon } from './icons'

export default async function DashboardPage({
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, client_id')
    .eq('id', user.id)
    .maybeSingle()

  const isAdmin = profile?.role === 'admin'

  if (!profile?.client_id) {
    return (
      <main style={{ padding: '40px 40px 64px' }}>
        <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Vue d&apos;ensemble</h1>
        <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Suivi global des campagnes</p>
        <p style={{ marginTop: 20, color: muted }}>Aucun client associé à ce compte.</p>
      </main>
    )
  }

  // ─── Période active : KPI exacts issus de campaign_daily_stats ──────────
  // (sommes journalières réelles, jamais une estimation depuis les totaux
  // campagne — voir BRIEF-CLAUDE-CODE.md).
  if (resolvedRange) {
    const { data: dailyRowsRaw, error: dailyError } = await supabase
      .from('campaign_daily_stats')
      .select('campaign_id, stat_date, meta_spend, meta_pixel_leads, calendly_appointments')
      .eq('client_id', profile.client_id)
      .gte('stat_date', resolvedRange.start)
      .lte('stat_date', resolvedRange.end)
      .order('stat_date', { ascending: true })

    if (dailyError) {
      return (
        <main style={{ padding: '40px 40px 64px' }}>
          <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Vue d&apos;ensemble</h1>
          <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Suivi global des campagnes</p>
          <p style={{ marginTop: 20, color: '#D93A3A' }}>Impossible de charger les statistiques journalières. Réessayez plus tard.</p>
        </main>
      )
    }

    const dailyRows = dailyRowsRaw ?? []

    if (dailyRows.length === 0) {
      return (
        <main style={{ padding: '40px 40px 64px' }}>
          <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Vue d&apos;ensemble</h1>
          <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>
            {formatPeriod(resolvedRange.start, resolvedRange.end)}
          </p>
          <div style={{ marginTop: 24 }}>
            <EmptyPeriodState />
          </div>
        </main>
      )
    }

    const byCampaign = new Map<string, { spend: number; leads: number; appointments: number }>()
    const byDate = new Map<string, { spend: number; appointments: number }>()
    for (const row of dailyRows) {
      const c = byCampaign.get(row.campaign_id) ?? { spend: 0, leads: 0, appointments: 0 }
      c.spend += row.meta_spend
      c.leads += row.meta_pixel_leads
      c.appointments += row.calendly_appointments
      byCampaign.set(row.campaign_id, c)

      const d = byDate.get(row.stat_date) ?? { spend: 0, appointments: 0 }
      d.spend += row.meta_spend
      d.appointments += row.calendly_appointments
      byDate.set(row.stat_date, d)
    }

    const totalSpend = dailyRows.reduce((sum, r) => sum + r.meta_spend, 0)
    const totalAppointments = dailyRows.reduce((sum, r) => sum + r.calendly_appointments, 0)
    const avgRealCostPerAppointment = realCostPerAppointment(totalSpend, totalAppointments)

    const dailyPoints: DailyPoint[] = enumerateDateRange(resolvedRange.start, resolvedRange.end).map((date) => ({
      date,
      spend: byDate.get(date)?.spend ?? 0,
      appointments: byDate.get(date)?.appointments ?? 0,
    }))

    const { data: campaignMeta } = await supabase
      .from('campaigns')
      .select('id, campaign_number, published')
      .eq('client_id', profile.client_id)
      .order('campaign_number', { ascending: true })

    // État de publication (indépendant du statut Meta) : le client ne voit
    // que les campagnes published=true, décision exclusivement admin (voir
    // aussi comparison/page.tsx et campaigns/[id]/page.tsx, même règle).
    // L'admin voit tout, y compris les campagnes non encore publiées.
    const visibleCampaignMeta = (campaignMeta ?? []).filter((c) => isAdmin || c.published)

    const campaignRows = visibleCampaignMeta
      .filter((c) => byCampaign.has(c.id))
      .map((c) => {
        const agg = byCampaign.get(c.id)!
        return {
          id: c.id,
          campaignNumber: c.campaign_number,
          spend: agg.spend,
          appointments: agg.appointments,
          costPerAppt: realCostPerAppointment(agg.spend, agg.appointments),
        }
      })

    return (
      <main style={{ padding: '40px 40px 64px' }}>
        <style>{`
          .amerys-card-list { display: none; }
          @media (max-width: 640px) {
            .amerys-table-wrap { display: none; }
            .amerys-card-list { display: flex; }
          }
        `}</style>

        <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Vue d&apos;ensemble</h1>
        <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>{formatPeriod(resolvedRange.start, resolvedRange.end)}</p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 18,
            margin: '30px 0',
          }}
        >
          <KpiCard
            icon={<DollarIcon size={20} />}
            iconColor={indigo}
            iconBg={lavender}
            label="Dépensé"
            value={`${formatEur(totalSpend)} €`}
            foot="somme des jours de la période"
          />
          <KpiCard
            icon={<CalendarIcon size={20} />}
            iconColor={violet}
            iconBg={lavender}
            label="Rendez-vous"
            value={String(totalAppointments)}
            foot="somme des jours de la période"
          />
          <KpiCard
            icon={<UserIcon size={20} />}
            iconColor={amber}
            iconBg={softBg(amber, 0.14)}
            label="Coût / RDV réel"
            value={formatCost(avgRealCostPerAppointment)}
          />
        </div>

        <div style={{ margin: '0 0 32px' }}>
          <OverviewDailyChart points={dailyPoints} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontWeight: 700, fontSize: 17 }}>Campagnes</h2>
        </div>

        <div className="amerys-table-wrap" style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {['#', 'Campagne', 'Dépensé', 'Rendez-vous', 'Coût / RDV réel'].map((label, i) => (
                    <th
                      key={label}
                      style={{
                        textAlign: i === 1 ? 'left' : 'right',
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
                {campaignRows.map((row, index) => (
                  <tr key={row.id} style={{ borderTop: index === 0 ? 'none' : `1px solid ${line}` }}>
                    <td style={{ padding: '14px 16px', fontSize: 13.5, fontWeight: 700, color: accent, textAlign: 'right' }}>
                      {row.campaignNumber}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <Link
                        href={`/dashboard/campaigns/${row.id}${queryString}`}
                        style={{ fontWeight: 600, fontSize: 14, color: accent, textDecoration: 'none' }}
                      >
                        Campagne {row.campaignNumber}
                      </Link>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatEur(row.spend)} €
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, textAlign: 'right' }}>{row.appointments}</td>
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatCost(row.costPerAppt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="amerys-card-list" style={{ flexDirection: 'column', gap: 12 }}>
          {campaignRows.map((row) => (
            <div key={row.id} style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>#{row.campaignNumber}</span>
                <Link
                  href={`/dashboard/campaigns/${row.id}${queryString}`}
                  style={{ fontWeight: 600, fontSize: 15, color: accent, textDecoration: 'none' }}
                >
                  Campagne {row.campaignNumber}
                </Link>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                    Dépensé
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>{formatEur(row.spend)} €</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                    Rendez-vous
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>{row.appointments}</div>
                </div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${line}` }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                  Coût / RDV réel
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>{formatCost(row.costPerAppt)}</div>
              </div>
            </div>
          ))}
        </div>
      </main>
    )
  }

  // ─── Aucune période sélectionnée : vue historique inchangée ─────────────
  let campaigns: {
    id: string
    campaign_number: number
    start_date: string | null
    end_date: string | null
    published: boolean
    meta_spend: number
    meta_pixel_leads: number
    manual_appointments_adjustment: number
    calendlyAppointments: number
    sync_locked: boolean
  }[] = []
  let campaignsError: string | null = null
  // Granularité réelle par jour/campagne (stat_date dérivée de
  // booking_created_at pour les RDV, voir lib/sync/syncCalendlyDailyStats.ts) —
  // seule source utilisée par OverviewChart.tsx pour le groupement "Par mois"
  // (correctif de recette, voir son en-tête) : jamais recalculée depuis les
  // totaux campagne ci-dessus, qui restent réservés au groupement "Par
  // campagne"/Totaux/Par jour, inchangés.
  let dailyStats: { campaign_id: string; stat_date: string; meta_spend: number; calendly_appointments: number }[] = []

  const { data, error } = await supabase
    .from('campaigns')
    .select(
      'id, campaign_number, start_date, end_date, published, meta_spend, meta_pixel_leads, manual_appointments_adjustment, status, sync_locked'
    )
    .eq('client_id', profile.client_id)
    .order('campaign_number', { ascending: true })

  if (error) {
    campaignsError = error.message
  } else {
    // État de publication (indépendant du statut Meta) : le client ne voit
    // que les campagnes published=true, décision exclusivement admin (voir
    // aussi comparison/page.tsx et campaigns/[id]/page.tsx). L'admin voit
    // tout, y compris les campagnes non encore publiées.
    const loaded = (data ?? []).filter((c) => isAdmin || c.published)
    // RDV réels par campagne : comptés directement dans appointments
    // (status='active', campaign_id rattaché) plutôt que lus depuis
    // campaigns.calendly_appointments, qui reste à 0 par défaut (jamais
    // écrit par la synchro, voir BRIEF-CLAUDE-CODE.md section 5).
    const counts = await Promise.all(
      loaded.map(async (c) => {
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

    campaigns = loaded.map((c, i) => ({ ...c, calendlyAppointments: counts[i] }))

    if (loaded.length > 0) {
      const { data: dailyStatsData, error: dailyStatsError } = await supabase
        .from('campaign_daily_stats')
        .select('campaign_id, stat_date, meta_spend, calendly_appointments')
        .eq('client_id', profile.client_id as string)
        .in(
          'campaign_id',
          loaded.map((c) => c.id)
        )
      if (dailyStatsError) {
        logError('api', `client ${profile.client_id}`, `lecture campaign_daily_stats (Par mois) : ${dailyStatsError.message}`)
      } else {
        dailyStats = dailyStatsData ?? []
      }
    }
  }

  const totalSpend = campaigns.reduce((sum, c) => sum + c.meta_spend, 0)
  const totalRealAppointments = campaigns.reduce(
    (sum, c) => sum + realAppointments(c.calendlyAppointments, c.manual_appointments_adjustment),
    0
  )
  const avgRealCostPerAppointment = realCostPerAppointment(totalSpend, totalRealAppointments)

  return (
    <main style={{ padding: '40px 40px 64px' }}>
      <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Vue d&apos;ensemble</h1>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Suivi global des campagnes</p>

      {campaignsError ? (
        <p style={{ marginTop: 20, color: '#D93A3A' }}>
          Impossible de charger les campagnes pour le moment. Réessayez plus tard.
        </p>
      ) : campaigns.length === 0 ? (
        <p style={{ marginTop: 20, color: muted }}>Aucune campagne synchronisée pour le moment.</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 18,
              margin: '30px 0',
            }}
          >
            <KpiCard
              icon={<DollarIcon size={20} />}
              iconColor={indigo}
              iconBg={lavender}
              label="Dépensé"
              value={`${totalSpend.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`}
            />
            <KpiCard
              icon={<CalendarIcon size={20} />}
              iconColor={violet}
              iconBg={lavender}
              label="Rendez-vous"
              value={String(totalRealAppointments)}
            />
            <KpiCard
              icon={<UserIcon size={20} />}
              iconColor={amber}
              iconBg={softBg(amber, 0.14)}
              label="Coût / RDV réel"
              value={formatCost(avgRealCostPerAppointment)}
            />
          </div>

          <OverviewSection campaigns={campaigns} dailyStats={dailyStats} isAdmin={isAdmin} />
        </>
      )}
    </main>
  )
}
