// Alimente campaign_daily_stats.calendly_appointments à partir des rendez-
// vous déjà synchronisés et rattachés (appointments.status='active',
// campaign_id non nul — voir lib/sync/syncAppointments.ts, non modifié ici :
// cette fonction ne lit que la table appointments, aucun appel Calendly).
// Miroir de syncCampaignDailyStats.ts (synchro Meta quotidienne) pour la
// structure, mais écrit exclusivement calendly_appointments : meta_spend et
// meta_pixel_leads sont systématiquement omis du payload d'upsert, jamais
// écrasés.
//
// Contrairement à la synchro Meta (qui n'insère que les jours réellement
// retournés par l'API), celle-ci doit aussi remettre à 0 les jours déjà
// présents en base (créés par la synchro Meta ou un run Calendly précédent)
// qui n'ont plus aucun rendez-vous actif rattaché aujourd'hui — sinon un
// rendez-vous annulé ou détaché laisserait un compteur obsolète. D'où
// l'union de deux sources : les jours réellement comptés (source de vérité)
// et les jours déjà présents en base pour ce client (remis à 0 s'ils n'ont
// plus de rendez-vous).
//
// Aucune donnée personnelle lue : seuls campaign_id et start_time (voir
// lib/calendly/appointments.ts — jamais nom/email/téléphone/réponses libres).

import { createAdminClient } from '@/lib/supabase/admin'
import { parisDateFromInstant } from '@/lib/calculations'

export type SyncCalendlyDailyStatsResult = {
  clientId: string
  daysWritten: number
  daysWithAppointments: number
  daysZeroed: number
}

export async function syncCalendlyDailyStats(clientId: string): Promise<SyncCalendlyDailyStatsResult> {
  const supabase = createAdminClient()

  // Rendez-vous actifs rattachés à une campagne — jamais de donnée
  // personnelle (voir en-tête).
  const { data: appointmentRows, error: appointmentsError } = await supabase
    .from('appointments')
    .select('campaign_id, start_time')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .not('campaign_id', 'is', null)

  if (appointmentsError) {
    throw new Error(`Échec lecture rendez-vous rattachés : ${appointmentsError.message}`)
  }

  const counts = new Map<string, number>()
  for (const row of appointmentRows ?? []) {
    if (!row.campaign_id) continue
    const statDate = parisDateFromInstant(row.start_time)
    const key = `${row.campaign_id}|${statDate}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  // Jours déjà en base pour ce client : à remettre à 0 s'ils n'ont plus de
  // rendez-vous (voir en-tête).
  const { data: existingRows, error: existingError } = await supabase
    .from('campaign_daily_stats')
    .select('campaign_id, stat_date')
    .eq('client_id', clientId)

  if (existingError) {
    throw new Error(`Échec lecture campaign_daily_stats existants : ${existingError.message}`)
  }

  const allKeys = new Set<string>(counts.keys())
  for (const row of existingRows ?? []) {
    allKeys.add(`${row.campaign_id}|${row.stat_date}`)
  }

  if (allKeys.size === 0) {
    return { clientId, daysWritten: 0, daysWithAppointments: 0, daysZeroed: 0 }
  }

  const rows = Array.from(allKeys).map((key) => {
    const [campaignId, statDate] = key.split('|')
    return {
      client_id: clientId,
      campaign_id: campaignId,
      stat_date: statDate,
      calendly_appointments: counts.get(key) ?? 0,
      // meta_spend / meta_pixel_leads volontairement absents du payload :
      // jamais écrasés par cette synchro Calendly-only.
    }
  })

  const { error: upsertError } = await supabase
    .from('campaign_daily_stats')
    .upsert(rows, { onConflict: 'campaign_id,stat_date' })

  if (upsertError) {
    throw new Error(`Échec upsert campaign_daily_stats (Calendly) : ${upsertError.message}`)
  }

  return {
    clientId,
    daysWritten: rows.length,
    daysWithAppointments: counts.size,
    daysZeroed: rows.length - counts.size,
  }
}
