// Formes brutes de l'API Calendly v2 (https://api.calendly.com), utilisées
// pour la validation Phase 0 (scripts/test-calendly.ts). Aucun rapprochement
// avec les campagnes Meta à ce stade — types volontairement minimaux.

export type CalendlyErrorResponse = {
  title: string
  message: string
}

export type CalendlyCurrentUser = {
  uri: string
  current_organization: string
}

export type CalendlyEventType = {
  uri: string
  name: string
  slug: string
  active: boolean
}

export type CalendlyScheduledEvent = {
  uri: string
  name: string
  status: string
  start_time: string
  end_time: string
  event_type: string
}

export type CalendlyQuestionAnswer = {
  question: string
  answer: string
  position: number
}

// name/email/text_reminder_number existent sur l'objet réel mais ne sont
// jamais lus ni journalisés ici (donnée personnelle).
export type CalendlyInvitee = {
  uri: string
  status: string
  questions_and_answers: CalendlyQuestionAnswer[]
}

export type CalendlyListResponse<T> = {
  collection: T[]
  pagination: { next_page: string | null; count: number }
}

// Les endpoints "objet unique" de l'API v2 (ex. /users/me) enveloppent leur
// résultat dans une clé "resource".
export type CalendlyResourceResponse<T> = {
  resource: T
}
