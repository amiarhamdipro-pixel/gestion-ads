// Orchestration Calendly -> Supabase pour la table appointments. Lecture
// seule côté Calendly (voir lib/calendly/appointments.ts). Synchro réellement
// différentielle : chaque rendez-vous est comparé à la ligne existante
// (event_type_uri, start_time, status, acquisition_channel, campaign_id) et
// seuls les créations/changements réels sont envoyés à l'upsert (clé externe
// stable calendly_event_uri, unique en base, migration
// 20260801000000_appointments.sql) — un rendez-vous identique n'est pas
// réécrit. campaign_id est rattaché automatiquement par fenêtre de dates
// (campagnes du même client, start_date/end_date non nulles uniquement,
// lib/calculations.ts) : aucune ventilation Barbier/Coiffeur, aucune
// attribution arbitraire en cas de chevauchement (erreur explicite à la
// place).

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAppointments, type CalendlyAppointmentRaw } from '@/lib/calendly/appointments'
import { mapCalendlyEventToAppointmentInsert } from '@/lib/calendly/mapper'
import { campaignsMatchingAppointment, type CampaignWindow } from '@/lib/calculations'
import type { Appointment } from '@/types/database'

type ExistingAppointmentRow = Pick<
  Appointment,
  'calendly_event_uri' | 'event_type_uri' | 'start_time' | 'status' | 'acquisition_channel' | 'campaign_id'
>

type AppointmentWithCampaign = CalendlyAppointmentRaw & { campaign_id: string | null }

// start_time est comparé par instant (Date.getTime()), pas par égalité de
// chaîne : Calendly renvoie "...Z" alors que Postgres/PostgREST renvoie
// "...+00:00" pour le même instant — une comparaison de chaînes classerait
// systématiquement la ligne "modifiée" (constaté en conditions réelles).
function isUnchanged(existing: ExistingAppointmentRow, incoming: AppointmentWithCampaign): boolean {
  return (
    existing.event_type_uri === incoming.event_type_uri &&
    new Date(existing.start_time).getTime() === new Date(incoming.start_time).getTime() &&
    existing.status === incoming.status &&
    existing.acquisition_channel === incoming.acquisition_channel &&
    existing.campaign_id === incoming.campaign_id
  )
}

export type SyncAppointmentsResult = {
  read: number
  created: number
  updated: number
  skipped: number
  errors: number
  errorDetails: string[]
  campaignsAssigned: number
  campaignsUnassigned: number
}

// .in() sérialise la liste dans la query string (requête GET) : au-delà de
// quelques dizaines d'URIs Calendly, la longueur dépasse la limite du proxy
// Supabase et échoue silencieusement (erreur au message vide) — observé en
// conditions réelles avec 1145 rendez-vous. D'où le découpage par lots, aussi
// bien pour la lecture de l'existant que pour l'upsert.
const CHUNK_SIZE = 50

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export async function syncAppointments(clientId: string): Promise<SyncAppointmentsResult> {
  const supabase = createAdminClient()
  const { appointments: raw, errors: fetchErrors } = await fetchAppointments()

  // skipped compte deux cas : un doublon Calendly au sein du même lot
  // (défensif — ne devrait pas arriver, statuts actif/annulé disjoints) et,
  // plus bas, un rendez-vous déjà en base et strictement identique
  // (isUnchanged). Dans les deux cas, rien n'est envoyé à l'upsert.
  const seen = new Set<string>()
  const deduped: CalendlyAppointmentRaw[] = []
  let skipped = 0

  for (const appointment of raw) {
    if (seen.has(appointment.calendly_event_uri)) {
      skipped += 1
      continue
    }
    seen.add(appointment.calendly_event_uri)
    deduped.push(appointment)
  }

  const errorDetails = [...fetchErrors]

  if (deduped.length === 0) {
    return {
      read: raw.length,
      created: 0,
      updated: 0,
      skipped,
      errors: errorDetails.length,
      errorDetails,
      campaignsAssigned: 0,
      campaignsUnassigned: 0,
    }
  }

  const existingByUri = new Map<string, ExistingAppointmentRow>()
  for (const batch of chunk(
    deduped.map((a) => a.calendly_event_uri),
    CHUNK_SIZE
  )) {
    const { data: existingRows, error: existingError } = await supabase
      .from('appointments')
      .select('calendly_event_uri, event_type_uri, start_time, status, acquisition_channel, campaign_id')
      .in('calendly_event_uri', batch)

    if (existingError) {
      throw new Error(
        `Échec lecture des rendez-vous existants : ${existingError.message || JSON.stringify(existingError)}`
      )
    }
    for (const row of existingRows ?? []) {
      existingByUri.set(row.calendly_event_uri, row)
    }
  }

  // Campagnes du même client uniquement, avec start_date ET end_date
  // renseignées (les autres sont ignorées : fenêtre indéterminée).
  const { data: campaignRows, error: campaignsError } = await supabase
    .from('campaigns')
    .select('id, start_date, end_date')
    .eq('client_id', clientId)
    .not('start_date', 'is', null)
    .not('end_date', 'is', null)

  if (campaignsError) {
    throw new Error(`Échec lecture des campagnes : ${campaignsError.message || JSON.stringify(campaignsError)}`)
  }

  const campaignWindows: CampaignWindow[] = (campaignRows ?? [])
    .filter((c): c is { id: string; start_date: string; end_date: string } => c.start_date !== null && c.end_date !== null)
    .map((c) => ({ id: c.id, startDate: c.start_date, endDate: c.end_date }))

  let created = 0
  let updated = 0
  let campaignsAssigned = 0
  let campaignsUnassigned = 0
  const toUpsert: AppointmentWithCampaign[] = []

  for (const appointment of deduped) {
    const existing = existingByUri.get(appointment.calendly_event_uri)
    const matches = campaignsMatchingAppointment(campaignWindows, appointment.start_time)

    let campaignId: string | null
    if (matches.length > 1) {
      // Chevauchement : aucune attribution arbitraire. On préserve la valeur
      // déjà en base (ou null pour une création) et on journalise l'erreur.
      campaignId = existing?.campaign_id ?? null
      errorDetails.push(
        `Rendez-vous ${appointment.calendly_event_uri} : ${matches.length} campagnes se chevauchent ` +
          `(${matches.join(', ')}) — aucune attribution automatique.`
      )
    } else {
      campaignId = matches[0] ?? null
    }

    if (campaignId) {
      campaignsAssigned += 1
    } else {
      campaignsUnassigned += 1
    }

    const incoming: AppointmentWithCampaign = { ...appointment, campaign_id: campaignId }

    if (!existing) {
      created += 1
      toUpsert.push(incoming)
    } else if (isUnchanged(existing, incoming)) {
      skipped += 1
    } else {
      updated += 1
      toUpsert.push(incoming)
    }
  }

  for (const batch of chunk(toUpsert, CHUNK_SIZE)) {
    const payload = batch.map((appointment) =>
      mapCalendlyEventToAppointmentInsert(clientId, appointment, appointment.campaign_id)
    )
    const { error: upsertError } = await supabase.from('appointments').upsert(payload, { onConflict: 'calendly_event_uri' })

    if (upsertError) {
      throw new Error(`Échec upsert appointments : ${upsertError.message || JSON.stringify(upsertError)}`)
    }
  }

  return {
    read: raw.length,
    created,
    updated,
    skipped,
    errors: errorDetails.length,
    errorDetails,
    campaignsAssigned,
    campaignsUnassigned,
  }
}
