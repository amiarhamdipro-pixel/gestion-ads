import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { realAppointments, realCostPerAppointment } from '@/lib/calculations'
import OverviewSection from './OverviewSection'
import KpiCard from './KpiCard'
import { amber, formatCost, green, indigo, lavender, muted, softBg, violet } from './format'
import { CalendarIcon, DollarIcon, SyncIcon, UserIcon } from './icons'

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
    .select('role, client_id')
    .eq('id', user.id)
    .maybeSingle()

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
  const totalRealAppointments = campaigns.reduce(
    (sum, c) => sum + realAppointments(c.calendlyAppointments, c.manual_appointments_adjustment),
    0
  )
  const avgRealCostPerAppointment = realCostPerAppointment(totalSpend, totalRealAppointments)
  const isAdmin = profile?.role === 'admin'

  return (
    <main style={{ padding: '40px 40px 64px' }}>
      <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Vue d&apos;ensemble</h1>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Suivi global des campagnes</p>

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
            <KpiCard
              icon={<SyncIcon size={20} />}
              iconColor={green}
              iconBg={softBg(green, 0.14)}
              label="Campagnes synchronisées"
              value={String(campaigns.length)}
            />
          </div>

          <OverviewSection campaigns={campaigns} isAdmin={isAdmin} />
        </>
      )}
    </main>
  )
}
