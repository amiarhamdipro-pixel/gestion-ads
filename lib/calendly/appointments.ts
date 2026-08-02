// Lecture des rendez-vous Calendly, en lecture seule (GET uniquement),
// pagination complète, limitée aux deux statuts pertinents (active, canceled
// — voir BRIEF-CLAUDE-CODE.md section 3). Ne lit et ne renvoie que les champs
// strictement nécessaires au dashboard : jamais de nom, email, téléphone, ni
// de réponse libre de formulaire (voir CalendlyInvitee, types.ts) — seule la
// réponse à la question "canal d'acquisition" (catégorielle, non personnelle,
// confirmée lors de l'investigation Phase 0, scripts/test-calendly.ts) est
// extraite. Aucun rapprochement Meta ici.
//
// Cause racine de la panne de synchro (mesurée en conditions réelles, 1147
// événements) : l'API Calendly n'expose pas les réponses de formulaire sur
// /scheduled_events lui-même — un appel /invitees séparé est nécessaire par
// événement pour connaître son acquisition_channel. La version précédente
// refaisait cet appel pour TOUS les événements à CHAQUE synchro, y compris
// les rendez-vous déjà connus dont le canal ne change jamais après coup —
// avec 1147 événements, une boucle séquentielle prenait plus de 2 minutes
// (parallélisée, encore ~130-150s à cause de la limite de débit propre au
// compte Calendly, HTTP 429 mesuré en conditions réelles), largement au-delà
// du délai d'exécution d'une route HTTP (timeout plateforme/proxy) : la
// requête n'aboutissait jamais côté admin, sans qu'aucune exception
// applicative ne soit levée (le process est arrêté de l'extérieur).
//
// Découpage en deux étapes distinctes pour permettre à l'appelant
// (lib/sync/syncAppointments.ts, qui seul connaît l'état déjà en base) de ne
// solliciter /invitees que pour les événements qui en ont réellement besoin
// (nouveaux, ou canal existant null/vide) :
// - fetchScheduledEvents() : liste complète des événements (statut,
//   start_time, event_type_uri) — un seul type d'appel (/scheduled_events),
//   aucun /invitees, donc rapide et sans risque de limite de débit quel que
//   soit le volume.
// - fetchAcquisitionChannels(eventUris) : n'interroge /invitees QUE pour les
//   URIs demandées, avec la même parallélisation bornée + retry qu'avant.

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

export type CalendlyScheduledAppointment = Omit<CalendlyAppointmentRaw, 'acquisition_channel'>

export type FetchScheduledEventsResult = {
  events: CalendlyScheduledAppointment[]
  errors: string[]
}

export type FetchAcquisitionChannelsResult = {
  // Clé = calendly_event_uri. Une entrée absente signifie un échec de
  // lecture pour cette URI (voir errors) ; le canal existant en base doit
  // alors être préservé par l'appelant, jamais remplacé par null.
  channels: Map<string, string | null>
  errors: string[]
  invited: number
}

function acquisitionChannelQuestion(): string {
  return (process.env.CALENDLY_ACQUISITION_CHANNEL_QUESTION || DEFAULT_ACQUISITION_CHANNEL_QUESTION)
    .trim()
    .toLowerCase()
}

// Nombre d'appels /invitees menés de front. Pas de dépendance ajoutée (pas de
// bibliothèque de limitation de concurrence) : implémentation minimale à base
// de workers Promise.all.
const INVITEE_FETCH_CONCURRENCY = 4

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await fn(items[currentIndex])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
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

// Liste les événements (actifs + annulés) sans jamais appeler /invitees :
// rapide et à coût constant quel que soit le volume historique.
export async function fetchScheduledEvents(): Promise<FetchScheduledEventsResult> {
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

  const result: CalendlyScheduledAppointment[] = []
  const errors: string[] = []

  for (const event of events) {
    if (event.status === 'active' || event.status === 'canceled') {
      result.push({
        calendly_event_uri: event.uri,
        event_type_uri: event.event_type,
        start_time: event.start_time,
        status: event.status,
      })
    } else {
      errors.push(`Rendez-vous ${event.uri} ignoré : statut inattendu "${event.status}".`)
    }
  }

  return { events: result, errors }
}

// N'appelle /invitees que pour les URIs fournies par l'appelant (nouveaux
// rendez-vous, ou canal déjà en base null/vide — jamais pour un canal déjà
// renseigné : voir lib/sync/syncAppointments.ts).
export async function fetchAcquisitionChannels(eventUris: string[]): Promise<FetchAcquisitionChannelsResult> {
  const channels = new Map<string, string | null>()
  const errors: string[] = []

  await mapWithConcurrency(eventUris, INVITEE_FETCH_CONCURRENCY, async (eventUri) => {
    try {
      channels.set(eventUri, await findAcquisitionChannel(eventUri))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`Échec lecture des invités pour ${eventUri} : ${message}`)
    }
  })

  return { channels, errors, invited: eventUris.length }
}
