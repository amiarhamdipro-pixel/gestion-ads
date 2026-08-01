import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { realAppointments, realCostPerAppointment } from '@/lib/calculations'
import { logout } from './actions'
import SyncMetaButton from './SyncMetaButton'
import OverviewSection from './OverviewSection'
import KpiCard from './KpiCard'
import { accent, formatCost, formatEur, ink, muted, spendColor } from './format'

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
    manual_appointments_adjustment: number
    calendlyAppointments: number
  }[] = []
  let campaignsError: string | null = null

  if (profile?.client_id) {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, campaign_number, start_date, end_date, meta_spend, meta_pixel_leads, manual_appointments_adjustment')
      .eq('client_id', profile.client_id)
      .order('campaign_number', { ascending: true })

    if (error) {
      campaignsError = error.message
    } else {
      const loaded = data ?? []
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
            console.error(`Échec comptage rendez-vous campagne ${c.id} : ${countError.message}`)
          }
          return count ?? 0
        })
      )
      campaigns = loaded.map((c, i) => ({ ...c, calendlyAppointments: counts[i] }))
    }
  }

  const totalSpend = campaigns.reduce((sum, c) => sum + c.meta_spend, 0)
  const totalLeads = campaigns.reduce((sum, c) => sum + c.meta_pixel_leads, 0)
  const totalRealAppointments = campaigns.reduce(
    (sum, c) => sum + realAppointments(c.calendlyAppointments, c.manual_appointments_adjustment),
    0
  )
  const avgRealCostPerAppointment = realCostPerAppointment(totalSpend, totalRealAppointments)
  const isAdmin = profile?.role === 'admin'

  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', fontFamily: 'sans-serif', color: ink }}>
      <p style={{ fontSize: 13, color: muted }}>
        Connecté en tant que {user.email} · Rôle : {profile?.role ?? 'inconnu'} · Client : {clientName ?? '—'}
      </p>

      {isAdmin ? <SyncMetaButton /> : null}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 24 }}>
        <h1 style={{ fontWeight: 600, fontSize: 23 }}>Vue d&apos;ensemble</h1>
        <Link href="/dashboard/comparison" style={{ marginLeft: 'auto', fontSize: 12.5, color: accent, textDecoration: 'none' }}>
          Comparaison →
        </Link>
      </div>
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
          {/* KPI globaux : totaux uniquement pour cet incrément, non affectés par le sélecteur Totaux/Par jour. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, margin: '20px 0' }}>
            <KpiCard label="Total dépensé" color={spendColor} value={`${formatEur(totalSpend)} €`} foot="sur la période" />
            <KpiCard
              label="Total rendez-vous"
              color={accent}
              value={String(totalRealAppointments)}
              foot={`dont ${totalLeads} lead${totalLeads > 1 ? 's' : ''} Meta (pixel)`}
            />
            <KpiCard
              label="Coût moyen réel / RDV"
              color={ink}
              value={formatCost(avgRealCostPerAppointment)}
              foot="dépensé ÷ RDV Calendly"
            />
          </div>

          <OverviewSection campaigns={campaigns} isAdmin={isAdmin} />
        </>
      )}

      <form action={logout} style={{ marginTop: 32 }}>
        <button type="submit">Se déconnecter</button>
      </form>
    </main>
  )
}
