// Lecture des rendez-vous Calendly, en lecture seule (GET uniquement),
// pagination complète, limitée aux deux statuts pertinents (active, canceled
// — voir BRIEF-CLAUDE-CODE.md section 3). Ne lit et ne renvoie que les champs
// strictement nécessaires au dashboard : jamais de nom, email, téléphone, ni
// de réponse libre de formulaire (voir CalendlyInvitee, types.ts) — seule la
// réponse à la question "canal d'acquisition" (catégorielle, non personnelle,
// confirmée lors de l'investigation Phase 0, scripts/test-calendly.ts) est
// extraite. Aucun rapprochement Meta ici.

import { calendlyGet, calendlyGetAllPages } from './client'
import type {
  CalendlyCurrentUser,
  CalendlyInvitee,
  CalendlyResourceResponse,
  CalendlyScheduledEvent,
} from './types'

const EVENT_STATUSES = ['active', 'canceled'] as const

// Texte confirmé lors de l'investigation Phase 0 sur l'échantillon testé.
// Configurable au cas où le formulaire Calendly serait reformulé.
const DEFAULT_ACQUISITION_CHANNEL_QUESTION = 'Par quel canal avez-vous découvert notre offre ?'

export type CalendlyAppointmentRaw = {
  calendly_event_uri: string
  event_type_uri: string
  start_time: string
  status: 'active' | 'canceled'
  acquisition_channel: string | null
}

export type FetchAppointmentsResult = {
  appointments: CalendlyAppointmentRaw[]
  errors: string[]
}

function acquisitionChannelQuestion(): string {
  return (process.env.CALENDLY_ACQUISITION_CHANNEL_QUESTION || DEFAULT_ACQUISITION_CHANNEL_QUESTION)
    .trim()
    .toLowerCase()
}

async function resolveOrganizationUri(): Promise<string> {
  if (process.env.CALENDLY_ORGANIZATION_URI) {
    return process.env.CALENDLY_ORGANIZATION_URI
  }
  const me = await calendlyGet<CalendlyResourceResponse<CalendlyCurrentUser>>('/users/me')
  return me.resource.current_organization
}

// Un rendez-vous Calendly (événement 1:1) n'a normalement qu'un seul invité :
// on ne lit que le premier. questions_and_answers ne contient jamais nom/
// email/téléphone (voir CalendlyInvitee) ; seule la réponse correspondant à
// la question canal d'acquisition est retenue, tout le reste est ignoré ici.
async function findAcquisitionChannel(eventUri: string): Promise<string | null> {
  const question = acquisitionChannelQuestion()
  const invitees = await calendlyGetAllPages<CalendlyInvitee>(`${eventUri}/invitees`, { count: '100' })
  const invitee = invitees[0]
  if (!invitee) return null

  const match = invitee.questions_and_answers.find((qa) => qa.question.trim().toLowerCase() === question)
  return match ? match.answer.trim() : null
}

export async function fetchAppointments(): Promise<FetchAppointmentsResult> {
  const organizationUri = await resolveOrganizationUri()

  const events: CalendlyScheduledEvent[] = []
  for (const status of EVENT_STATUSES) {
    const page = await calendlyGetAllPages<CalendlyScheduledEvent>('/scheduled_events', {
      organization: organizationUri,
      status,
      count: '100',
    })
    events.push(...page)
  }

  const appointments: CalendlyAppointmentRaw[] = []
  const errors: string[] = []

  for (const event of events) {
    if (event.status !== 'active' && event.status !== 'canceled') {
      errors.push(`Rendez-vous ${event.uri} ignoré : statut inattendu "${event.status}".`)
      continue
    }

    try {
      const acquisitionChannel = await findAcquisitionChannel(event.uri)
      appointments.push({
        calendly_event_uri: event.uri,
        event_type_uri: event.event_type,
        start_time: event.start_time,
        status: event.status,
        acquisition_channel: acquisitionChannel,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`Échec lecture des invités pour ${event.uri} : ${message}`)
    }
  }

  return { appointments, errors }
}
