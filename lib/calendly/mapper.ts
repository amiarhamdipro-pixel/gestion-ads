// Transformation pure : rendez-vous Calendly brut -> ligne Insert de la table
// appointments (types/database.ts). Aucun appel réseau ni base ici. N'écrit
// que les champs autorisés (calendly_event_uri, event_type_uri, start_time,
// status, acquisition_channel, booking_created_at) + client_id et
// campaign_id fournis par l'appelant. Calendly n'a aucune notion de
// campagne : le rattachement par date de création de réservation est calculé
// en amont dans lib/sync/syncAppointments.ts (lib/calculations.ts,
// campaignsMatchingAppointment), jamais ici.

import type { Database } from '@/types/database'
import type { CalendlyAppointmentRaw } from './appointments'

type AppointmentInsert = Database['public']['Tables']['appointments']['Insert']

export function mapCalendlyEventToAppointmentInsert(
  clientId: string,
  raw: CalendlyAppointmentRaw,
  campaignId: string | null
): AppointmentInsert {
  return {
    client_id: clientId,
    campaign_id: campaignId,
    calendly_event_uri: raw.calendly_event_uri,
    event_type_uri: raw.event_type_uri,
    start_time: raw.start_time,
    status: raw.status,
    acquisition_channel: raw.acquisition_channel,
    booking_created_at: raw.booking_created_at,
  }
}
