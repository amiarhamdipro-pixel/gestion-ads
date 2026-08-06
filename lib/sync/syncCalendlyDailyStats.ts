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
// et les jours déjà présents en base pour la campagne ciblée (remis à 0
// s'ils n'ont plus de rendez-vous).
//
// stat_date = date de CRÉATION de la réservation (booking_created_at), pas
// la date prévue du rendez-vous (start_time) — même règle que le
// rattachement de campagne (voir lib/sync/syncAppointments.ts) : un jour de
// statistiques doit refléter quand la conversion a eu lieu, pas quand le
// rendez-vous se tiendra. Un rendez-vous rattaché à une campagne a toujours
// un booking_created_at non nul (c'est ce champ qui a servi à le rattacher) ;
// le garde ci-dessous est purement défensif.
//
// Aucune donnée personnelle lue : seuls campaign_id et booking_created_at
// (voir lib/calendly/appointments.ts — jamais nom/email/téléphone/réponses
// libres).
//
// Sélection séquentielle (règle métier officielle, voir BRIEF-CLAUDE-CODE.md
// et lib/sync/syncAllCampaigns.ts, selectSequentialTarget) : cette fonction
// ne recalcule/n'écrit JAMAIS que pour la campagne ciblée ce passage —
// jamais pour une campagne verrouillée (historique figée ou publiée), ni
// pour une campagne dynamique "en attente" (pas son tour). Portée appliquée
// directement au niveau des requêtes (.eq('campaign_id', ...)), pas par un
// filtrage a posteriori : aucune ligne d'une autre campagne n'est même lue.

import { createAdminClient } from '@/lib/supabase/admin'
import { parisDateFromInstant } from '@/lib/calculations'

export type SyncCalendlyDailyStatsResult = {
  clientId: string
  campaignsProcessed: number
  daysWritten: number
  daysWithAppointments: number
  daysZeroed: number
}

const EMPTY_RESULT = (clientId: string): SyncCalendlyDailyStatsResult => ({
  clientId,
  campaignsProcessed: 0,
  daysWritten: 0,
  daysWithAppointments: 0,
  daysZeroed: 0,
})

// targetCampaignNumber : campagne dynamique ciblée ce passage (voir
// lib/sync/syncAllCampaigns.ts, selectSequentialTarget). null si aucune
// campagne dynamique candidate (toutes verrouillées) — succès propre, rien
// à recalculer.
export async function syncCalendlyDailyStats(
  clientId: string,
  targetCampaignNumber: number | null
): Promise<SyncCalendlyDailyStatsResult> {
  if (targetCampaignNumber === null) {
    return EMPTY_RESULT(clientId)
  }

  const supabase = createAdminClient()

  const { data: targetCampaign, error: targetError } = await supabase
    .from('campaigns')
    .select('id, sync_locked')
    .eq('client_id', clientId)
    .eq('campaign_number', targetCampaignNumber)
    .maybeSingle()

  if (targetError) {
    throw new Error(`Échec lecture campagne ciblée : ${targetError.message}`)
  }

  // Défense en profondeur (voir en-tête et lib/sync/syncAppointments.ts,
  // même principe) : jamais recalculer/écrire pour une campagne verrouillée,
  // même si l'appelant désignait par erreur une campagne sync_locked=true.
  if (!targetCampaign || targetCampaign.sync_locked) {
    return EMPTY_RESULT(clientId)
  }

  const targetCampaignId = targetCampaign.id

  // Rendez-vous actifs rattachés À LA CAMPAGNE CIBLÉE uniquement — jamais de
  // donnée personnelle (voir en-tête).
  const { data: appointmentRows, error: appointmentsError } = await supabase
    .from('appointments')
    .select('booking_created_at')
    .eq('client_id', clientId)
    .eq('campaign_id', targetCampaignId)
    .eq('status', 'active')

  if (appointmentsError) {
    throw new Error(`Échec lecture rendez-vous rattachés : ${appointmentsError.message}`)
  }

  const counts = new Map<string, number>()
  for (const row of appointmentRows ?? []) {
    // booking_created_at manquant : défensif uniquement (voir en-tête), on
    // n'invente pas de date de repli — ce rendez-vous est simplement exclu
    // des statistiques journalières tant qu'il n'est pas correctement enrichi.
    if (!row.booking_created_at) continue
    const statDate = parisDateFromInstant(row.booking_created_at)
    counts.set(statDate, (counts.get(statDate) ?? 0) + 1)
  }

  // Jours déjà en base pour CETTE campagne : à remettre à 0 s'ils n'ont plus
  // de rendez-vous (voir en-tête).
  const { data: existingRows, error: existingError } = await supabase
    .from('campaign_daily_stats')
    .select('stat_date')
    .eq('client_id', clientId)
    .eq('campaign_id', targetCampaignId)

  if (existingError) {
    throw new Error(`Échec lecture campaign_daily_stats existants : ${existingError.message}`)
  }

  const allDates = new Set<string>(counts.keys())
  for (const row of existingRows ?? []) {
    allDates.add(row.stat_date)
  }

  if (allDates.size === 0) {
    return EMPTY_RESULT(clientId)
  }

  const rows = Array.from(allDates).map((statDate) => ({
    client_id: clientId,
    campaign_id: targetCampaignId,
    stat_date: statDate,
    calendly_appointments: counts.get(statDate) ?? 0,
    // meta_spend / meta_pixel_leads volontairement absents du payload :
    // jamais écrasés par cette synchro Calendly-only.
  }))

  const { error: upsertError } = await supabase
    .from('campaign_daily_stats')
    .upsert(rows, { onConflict: 'campaign_id,stat_date' })

  if (upsertError) {
    throw new Error(`Échec upsert campaign_daily_stats (Calendly) : ${upsertError.message}`)
  }

  return {
    clientId,
    campaignsProcessed: 1,
    daysWritten: rows.length,
    daysWithAppointments: counts.size,
    daysZeroed: rows.length - counts.size,
  }
}
