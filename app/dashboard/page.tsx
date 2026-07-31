import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { costPerMetaPixelLead } from '@/lib/calculations'
import { logout } from './actions'
import SyncMetaButton from './SyncMetaButton'
import OverviewChart from './OverviewChart'
import EndDateEditor from './EndDateEditor'

// Palette reprise de dashboard-maquette_1.html (vue d'ensemble), sans copier
// sa feuille de style : couleurs et rayons approximés en inline styles.
const ink = '#16172E'
const muted = '#71748C'
const faint = '#9A9DB2'
const line = '#E4E7F0'
const surface = '#FFFFFF'
const surfaceAlt = '#F6F7FB'
const accent = '#4A38D1'
const spendColor = '#E28234'
const radius = 16

function formatEur(n: number): string {
  return Math.round(n).toLocaleString('fr-FR')
}

function formatCost(n: number | null): string {
  return n === null ? '—' : n.toFixed(2).replace('.', ',') + ' €'
}

function formatPeriod(startDate: string | null, endDate: string | null): string {
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  if (startDate && endDate) return `${formatter.format(new Date(startDate))} – ${formatter.format(new Date(endDate))}`
  if (startDate) return `À partir du ${formatter.format(new Date(startDate))}`
  return 'Période non disponible'
}

function KpiCard({ label, color, value, foot }: { label: string; color: string; value: string; foot: string }) {
  return (
    <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: muted, fontWeight: 500 }}>
        <i style={{ width: 9, height: 9, borderRadius: 3, background: color, display: 'inline-block' }} />
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: 26, marginTop: 8, color: ink }}>{value}</div>
      <div style={{ fontSize: 12, color: faint, marginTop: 6 }}>{foot}</div>
    </div>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, client_id, full_name')
    .eq('id', user.id)
    .maybeSingle()

  let clientName: string | null = null
  if (profile?.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', profile.client_id)
      .maybeSingle()
    clientName = client?.name ?? null
  }

  let campaigns: {
    id: string
    campaign_number: number
    start_date: string | null
    end_date: string | null
    meta_spend: number
    meta_pixel_leads: number
  }[] = []
  let campaignsError: string | null = null

  if (profile?.client_id) {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, campaign_number, start_date, end_date, meta_spend, meta_pixel_leads')
      .eq('client_id', profile.client_id)
      .order('campaign_number', { ascending: true })

    if (error) {
      campaignsError = error.message
    } else {
      campaigns = data ?? []
    }
  }

  const totalSpend = campaigns.reduce((sum, c) => sum + c.meta_spend, 0)
  const totalLeads = campaigns.reduce((sum, c) => sum + c.meta_pixel_leads, 0)
  const avgCostPerLead = costPerMetaPixelLead(totalSpend, totalLeads)

  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', fontFamily: 'sans-serif', color: ink }}>
      <p style={{ fontSize: 13, color: muted }}>
        Connecté en tant que {user.email} · Rôle : {profile?.role ?? 'inconnu'} · Client : {clientName ?? '—'}
      </p>

      {profile?.role === 'admin' ? <SyncMetaButton /> : null}

      <h1 style={{ fontWeight: 600, fontSize: 23, marginTop: 24 }}>Vue d&apos;ensemble</h1>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 3 }}>
        {campaigns.length} campagne{campaigns.length > 1 ? 's' : ''}
      </p>

      {!profile?.client_id ? (
        <p style={{ marginTop: 20, color: muted }}>Aucun client associé à ce compte.</p>
      ) : campaignsError ? (
        <p style={{ marginTop: 20, color: '#D93A3A' }}>
          Impossible de charger les campagnes pour le moment. Réessayez plus tard.
        </p>
      ) : campaigns.length === 0 ? (
        <p style={{ marginTop: 20, color: muted }}>Aucune campagne synchronisée pour le moment.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, margin: '20px 0' }}>
            <KpiCard label="Total dépensé" color={spendColor} value={`${formatEur(totalSpend)} €`} foot="sur la période" />
            <KpiCard label="Total leads Meta" color={accent} value={String(totalLeads)} foot="conversions pixel" />
            <KpiCard
              label="Coût moyen / lead"
              color={ink}
              value={formatCost(avgCostPerLead)}
              foot="dépensé ÷ leads Meta (pixel)"
            />
          </div>

          <div style={{ margin: '20px 0' }}>
            <OverviewChart campaigns={campaigns} />
          </div>

          <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
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
              <span>Campagne</span>
              <span>Dépensé</span>
              <span>Leads Meta</span>
              <span>Coût / lead</span>
            </div>
            {campaigns.map((campaign, index) => (
              <div
                key={campaign.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
                  gap: 14,
                  alignItems: 'center',
                  padding: '15px 18px',
                  borderTop: index === 0 ? 'none' : `1px solid ${line}`,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Campagne {campaign.campaign_number}</div>
                  <div style={{ color: muted, fontSize: 12, marginTop: 2 }}>
                    {formatPeriod(campaign.start_date, campaign.end_date)}
                  </div>
                  {profile?.role === 'admin' ? (
                    <EndDateEditor
                      campaignId={campaign.id}
                      startDate={campaign.start_date}
                      initialEndDate={campaign.end_date}
                    />
                  ) : null}
                </div>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{formatEur(campaign.meta_spend)} €</div>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{campaign.meta_pixel_leads}</div>
                <div style={{ fontWeight: 500, fontSize: 15 }}>
                  {formatCost(costPerMetaPixelLead(campaign.meta_spend, campaign.meta_pixel_leads))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <form action={logout} style={{ marginTop: 32 }}>
        <button type="submit">Se déconnecter</button>
      </form>
    </main>
  )
}
