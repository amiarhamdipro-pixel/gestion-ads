// Client HTTP Calendly générique (lecture seule, GET uniquement). Centralise
// l'appel authentifié et la pagination "collection" (pagination.next_page)
// utilisés par scripts/test-calendly.ts (Phase 0) et lib/calendly/appointments.ts.

import type { CalendlyListResponse } from './types'

const BASE_URL = 'https://api.calendly.com'

function calendlyToken(): string {
  const token = process.env.CALENDLY_ACCESS_TOKEN
  if (!token) {
    throw new Error('Missing CALENDLY_ACCESS_TOKEN environment variable.')
  }
  return token
}

// Limite de débit Calendly (HTTP 429) : observée en conditions réelles dès
// que lib/calendly/appointments.ts parallélise les appels /invitees (voir son
// en-tête). Sans ce correctif, un 429 pendant une synchro à grand volume
// faisait échouer silencieusement la lecture du canal d'acquisition pour le
// rendez-vous concerné (capturé comme erreur, jamais perdu en base, mais
// absent du run en cours) — jamais masqué (l'erreur brute est toujours levée
// au-delà de RATE_LIMIT_MAX_ATTEMPTS), mais évité autant que possible ici en
// respectant l'en-tête Retry-After quand Calendly le fournit, sinon un
// backoff exponentiel.
const RATE_LIMIT_MAX_ATTEMPTS = 5

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function calendlyGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = calendlyToken()
  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  let attempt = 0
  for (;;) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })

    if (response.status === 429 && attempt < RATE_LIMIT_MAX_ATTEMPTS) {
      attempt += 1
      const retryAfterSeconds = Number(response.headers.get('Retry-After'))
      const waitMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 500 * 2 ** attempt
      await sleep(waitMs)
      continue
    }

    // Lu en texte d'abord : un corps vide (erreur sans JSON, limite de débit
    // Calendly...) ferait échouer response.json() avec une SyntaxError opaque
    // ("Unexpected end of JSON input") qui masque le vrai statut HTTP — observé
    // en conditions réelles sur /invitees lors d'une synchro à grand volume.
    const raw = await response.text()
    let json: unknown = null
    if (raw) {
      try {
        json = JSON.parse(raw)
      } catch {
        throw new Error(`Calendly API — réponse non-JSON (HTTP ${response.status} ${response.statusText}).`)
      }
    }

    if (!response.ok) {
      const err = (json ?? {}) as { title?: string; message?: string }
      throw new Error(
        `Calendly API — ${err.title ?? 'erreur'} : ${err.message ?? response.statusText} (HTTP ${response.status})`
      )
    }

    return json as T
  }
}

// Suit pagination.next_page (URL complète renvoyée par Calendly) jusqu'à épuisement.
export async function calendlyGetAllPages<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = []
  let page = await calendlyGet<CalendlyListResponse<T>>(path, params)
  out.push(...page.collection)

  while (page.pagination.next_page) {
    page = await calendlyGet<CalendlyListResponse<T>>(page.pagination.next_page)
    out.push(...page.collection)
  }

  return out
}

export function lastPathSegment(uri: string): string {
  return uri.split('/').filter(Boolean).pop() ?? uri
}
