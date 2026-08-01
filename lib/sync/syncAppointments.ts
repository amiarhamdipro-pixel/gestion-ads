// Orchestration Calendly -> Supabase pour la table appointments. Lecture
// seule côté Calendly (voir lib/calendly/appointments.ts). Synchro réellement
// différentielle : chaque rendez-vous est comparé à la ligne existante
// (event_type_uri, start_time, status, acquisition_channel, campaign_id) et
// seuls les créations/changements réels sont envoyés à l'upsert (clé externe
// stable calendly_event_uri, unique en base, migration
// 20260801000000_appointments.sql) — un rendez-vous identique n'est pas
// réécrit. campaign_id reste toujours null ici : aucun rapprochement Meta/
// Calendly n'est fait dans cette tâche.

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAppointments, type CalendlyAppointmentRaw } from '@/lib/calendly/appointments'
import { mapCalendlyEventToAppointmentInsert } from '@/lib/calendly/mapper'
import type { Appointment } from '@/types/database'

type ExistingAppointmentRow = Pick<
  Appointment,
  'calendly_event_uri' | 'event_type_uri' | 'start_time' | 'status' | 'acquisition_channel' | 'campaign_id'
>

// campaign_id est toujours null côté mapping Calendly (lib/calendly/mapper.ts,
// aucun rapprochement Meta ici) : comparé à null, pas à une valeur incidente.
// start_time est comparé par instant (Date.getTime()), pas par égalité de
// chaîne : Calendly renvoie "...Z" alors que Postgres/PostgREST renvoie
// "...+00:00" pour le même instant — une comparaison de chaînes classerait
// systématiquement la ligne "modifiée" (constaté en conditions réelles).
function isUnchanged(existing: ExistingAppointmentRow, incoming: CalendlyAppointmentRaw): boolean {
  return (
    existing.event_type_uri === incoming.event_type_uri &&
    new Date(existing.start_time).getTime() === new Date(incoming.start_time).getTime() &&
    existing.status === incoming.status &&
    existing.acquisition_channel === incoming.acquisition_channel &&
    existing.campaign_id === null
  )
}

export type SyncAppointmentsResult = {
  read: number
  created: number
  updated: number
  skipped: number
  errors: number
  errorDetails: string[]
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

  if (deduped.length === 0) {
    return { read: raw.length, created: 0, updated: 0, skipped, errors: fetchErrors.length, errorDetails: fetchErrors }
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

  let created = 0
  let updated = 0
  const toUpsert: CalendlyAppointmentRaw[] = []

  for (const appointment of deduped) {
    const existing = existingByUri.get(appointment.calendly_event_uri)
    if (!existing) {
      created += 1
      toUpsert.push(appointment)
    } else if (isUnchanged(existing, appointment)) {
      skipped += 1
    } else {
      updated += 1
      toUpsert.push(appointment)
    }
  }

  for (const batch of chunk(toUpsert, CHUNK_SIZE)) {
    const payload = batch.map((appointment) => mapCalendlyEventToAppointmentInsert(clientId, appointment))
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
    errors: fetchErrors.length,
    errorDetails: fetchErrors,
  }
}
