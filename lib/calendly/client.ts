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

export async function calendlyGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = calendlyToken()
  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })

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
