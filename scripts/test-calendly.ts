// Script local, jetable : valide l'accès en lecture seule à l'API Calendly et
// identifie la réponse de formulaire qui distingue Instagram/Facebook.
// Lecture seule (GET), aucune écriture Supabase, aucun webhook, aucun
// rapprochement avec Meta. Aucune donnée personnelle journalisée : nom,
// email, téléphone et réponses libres non nécessaires restent masqués.
// Lance avec `npx tsx scripts/test-calendly.ts`.

import { readFileSync } from 'node:fs'
import { calendlyGet, lastPathSegment } from '../lib/calendly/client'
import type {
  CalendlyCurrentUser,
  CalendlyEventType,
  CalendlyInvitee,
  CalendlyListResponse,
  CalendlyResourceResponse,
  CalendlyScheduledEvent,
} from '../lib/calendly/types'

const REQUIRED_VARS = ['CALENDLY_ACCESS_TOKEN'] as const

// Questions dont la réponse est une donnée personnelle : jamais affichées.
const PERSONAL_QUESTION_PATTERN = /nom|prénom|email|e-mail|mail|téléphone|telephone|phone|adresse/i
const PLATFORM_PATTERN = /instagram|facebook/i

function loadEnvFile(file: string): void {
  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!match) continue
    const key = match[1]
    if (process.env[key]) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function assertRequiredEnv(): void {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Variable(s) manquante(s) dans .env : ${missing.join(', ')}`)
  }
}

async function main(): Promise<void> {
  loadEnvFile('.env')
  loadEnvFile('.env.local')
  assertRequiredEnv()

  console.log('=== Test 1 : authentification Calendly (GET /users/me) ===')
  const meResponse = await calendlyGet<CalendlyResourceResponse<CalendlyCurrentUser>>('/users/me')
  const me = meResponse.resource
  console.log(`✅ Authentification réussie. Organisation : ${lastPathSegment(me.current_organization)}`)

  const organizationUri = process.env.CALENDLY_ORGANIZATION_URI || me.current_organization
  if (!process.env.CALENDLY_ORGANIZATION_URI) {
    console.log('CALENDLY_ORGANIZATION_URI absent de .env — déduit automatiquement depuis /users/me.')
  }

  console.log("\n=== Test 2 : types d'événements ===")
  const eventTypes = await calendlyGet<CalendlyListResponse<CalendlyEventType>>('/event_types', {
    organization: organizationUri,
    count: '50',
  })
  console.log(`${eventTypes.collection.length} type(s) d'événement trouvé(s) :`)
  eventTypes.collection.forEach((et) => {
    console.log(`  • "${et.name}" (slug=${et.slug}) — actif=${et.active}`)
  })

  console.log('\n=== Test 3 : échantillon de rendez-vous confirmés récents ===')
  const events = await calendlyGet<CalendlyListResponse<CalendlyScheduledEvent>>('/scheduled_events', {
    organization: organizationUri,
    status: 'active',
    count: '10',
    sort: 'start_time:desc',
  })
  console.log(`${events.collection.length} rendez-vous confirmé(s) trouvé(s) (statut "active").`)

  if (events.collection.length === 0) {
    console.log('\nAucun rendez-vous à examiner — impossible de vérifier le champ plateforme sur cet échantillon.')
    return
  }

  events.collection.forEach((e) => {
    console.log(`  • id=${lastPathSegment(e.uri)} start=${e.start_time} status=${e.status} type=${lastPathSegment(e.event_type)}`)
  })

  console.log('\n=== Test 4 : réponses de formulaire (échantillon) ===')
  const sample = events.collection.slice(0, 5)

  // Passe 1 : récupère les invités et détecte la question plateforme (par mot-clé
  // dans la réponse ou l'intitulé) avant tout affichage.
  const inviteesByEvent: { eventId: string; questionsAndAnswers: CalendlyInvitee['questions_and_answers'] }[] = []
  let platformQuestion: string | null = null
  const platformValuesSeen = new Set<string>()

  for (const event of sample) {
    const invitees = await calendlyGet<CalendlyListResponse<CalendlyInvitee>>(`${event.uri}/invitees`, {
      count: '10',
    })

    for (const invitee of invitees.collection) {
      inviteesByEvent.push({ eventId: lastPathSegment(event.uri), questionsAndAnswers: invitee.questions_and_answers })
      for (const qa of invitee.questions_and_answers) {
        if (PLATFORM_PATTERN.test(qa.answer) || /plateforme|platform|réseau|canal/i.test(qa.question)) {
          platformQuestion = qa.question
        }
      }
    }
  }

  // Passe 2 : affiche — la question identifiée comme plateforme est révélée en
  // entier (catégorielle, non personnelle) ; le reste reste masqué.
  for (const { eventId, questionsAndAnswers } of inviteesByEvent) {
    console.log(`\n  Rendez-vous id=${eventId} :`)
    for (const qa of questionsAndAnswers) {
      if (qa.question === platformQuestion) {
        console.log(`    - "${qa.question}" -> "${qa.answer}"  [champ plateforme]`)
        platformValuesSeen.add(qa.answer.trim())
      } else if (PERSONAL_QUESTION_PATTERN.test(qa.question)) {
        console.log(`    - "${qa.question}" -> [MASQUÉ — donnée personnelle]`)
      } else {
        console.log(`    - "${qa.question}" -> [MASQUÉ — réponse libre non nécessaire]`)
      }
    }
  }

  console.log('\n=== Résultat : champ plateforme Instagram/Facebook ===')
  if (platformQuestion) {
    console.log(`✅ Question identifiée : "${platformQuestion}"`)
    console.log(`   Valeurs observées sur l'échantillon : ${Array.from(platformValuesSeen).join(', ')}`)
  } else {
    console.log(
      "❌ Aucune question de l'échantillon ne correspond clairement à un sélecteur Instagram/Facebook. " +
        "Absence établie sur cet échantillon — à reconfirmer si le formulaire Calendly change ou sur un échantillon plus large."
    )
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
