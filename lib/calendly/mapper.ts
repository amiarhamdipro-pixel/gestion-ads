// Transformation pure : rendez-vous Calendly brut -> ligne Insert de la table
// appointments (types/database.ts). Aucun appel réseau ni base ici. N'écrit
// que les champs autorisés (calendly_event_uri, event_type_uri, start_time,
// status, acquisition_channel) + client_id (fourni par l'appelant).
// campaign_id reste toujours null : aucun rapprochement Meta/Calendly n'est
// fait ici (voir BRIEF-CLAUDE-CODE.md section 3).

import type { Database } from '@/types/database'
import type { CalendlyAppointmentRaw } from './appointments'

type AppointmentInsert = Database['public']['Tables']['appointments']['Insert']

export function mapCalendlyEventToAppointmentInsert(
  clientId: string,
  raw: CalendlyAppointmentRaw
): AppointmentInsert {
  return {
    client_id: clientId,
    campaign_id: null,
    calendly_event_uri: raw.calendly_event_uri,
    event_type_uri: raw.event_type_uri,
    start_time: raw.start_time,
    status: raw.status,
    acquisition_channel: raw.acquisition_channel,
  }
}
