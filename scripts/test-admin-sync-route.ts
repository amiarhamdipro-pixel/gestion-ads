// Script local, jetable : teste POST /api/admin/sync en HTTP réel (le serveur
// Next.js doit déjà tourner, ex. `npm run dev`). Crée un utilisateur de test
// temporaire (admin) pour obtenir une vraie session cookie via @supabase/ssr,
// vérifie session/rôle/client (401, 403 sans client, 200, 400), puis supprime
// l'utilisateur de test. Le client utilisé pour le test est lu dynamiquement
// (n'importe quelle ligne existante) : jamais un slug/nom fixe, pour rester
// cohérent avec la route qui ne résout plus le client que depuis
// profiles.client_id. Aucune écriture Calendly, aucun autre numéro de
// campagne que celui de .env. Lance avec `npx tsx scripts/test-admin-sync-route.ts`.

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createServerClient } from '@supabase/ssr'
import { createAdminClient } from '../lib/supabase/admin'

const BASE_URL = 'http://localhost:3000'
const TEST_EMAIL = `test-admin-sync-${randomUUID()}@example.invalid`
const TEST_PASSWORD = randomUUID()

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

async function postSync(campaignNumber: unknown, cookieHeader?: string) {
  const response = await fetch(`${BASE_URL}/api/admin/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({ campaignNumber }),
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

async function main(): Promise<void> {
  loadEnvFile('.env')
  loadEnvFile('.env.local')

  console.log('=== Test 1 : anonyme + payload invalide → 401 attendu ===')
  const unauth = await postSync('vingt')
  console.log(`Statut : ${unauth.status}`, unauth.body)
  if (unauth.status !== 401) throw new Error(`Anomalie : statut ${unauth.status} au lieu de 401.`)

  const adminSupabase = createAdminClient()
  const { data: created, error: createError } = await adminSupabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (createError || !created.user) {
    throw new Error(`Échec création utilisateur de test : ${createError?.message ?? 'réponse vide'}`)
  }
  const testUserId = created.user.id

  try {
    const { error: profileError } = await adminSupabase
      .from('profiles')
      .insert({ id: testUserId, client_id: null, role: 'admin', full_name: 'Test admin (jetable)' })
    if (profileError) {
      throw new Error(`Échec création profil de test : ${profileError.message}`)
    }

    const jar = new Map<string, string>()
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
    const sessionClient = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
        setAll: (cookiesToSet) => cookiesToSet.forEach(({ name, value }) => jar.set(name, value)),
      },
    })

    const { error: signInError } = await sessionClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
    if (signInError) {
      throw new Error(`Échec connexion utilisateur de test : ${signInError.message}`)
    }

    const cookieHeader = Array.from(jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')

    console.log('\n=== Test 2 : admin authentifié sans client autorisé (client_id=null) → 403 attendu ===')
    const noClient = await postSync(20, cookieHeader)
    console.log(`Statut : ${noClient.status}`, noClient.body)
    if (noClient.status !== 403) throw new Error(`Anomalie : statut ${noClient.status} au lieu de 403.`)

    const { data: anyClient, error: anyClientError } = await adminSupabase.from('clients').select('id').limit(1).single()
    if (anyClientError || !anyClient) {
      throw new Error(`Aucun client existant pour le test (${anyClientError?.message ?? 'table vide'}).`)
    }

    const { error: attachError } = await adminSupabase
      .from('profiles')
      .update({ client_id: anyClient.id })
      .eq('id', testUserId)
    if (attachError) throw new Error(`Échec rattachement du client de test : ${attachError.message}`)

    console.log('\n=== Test 3 : admin associé à un client, payload valide → 200 attendu ===')
    const success = await postSync(Number(process.env.CAMPAIGN_NUMBER ?? 20), cookieHeader)
    console.log(`Statut : ${success.status}`, success.body)
    if (success.status !== 200) throw new Error(`Anomalie : statut ${success.status} au lieu de 200.`)

    const body = success.body as { counts?: { audiences: number; videos: number } }
    if (body.counts?.audiences !== 2 || body.counts?.videos !== 2) {
      throw new Error(`Anomalie : compteurs inattendus ${JSON.stringify(body.counts)} (2/2 attendus).`)
    }

    console.log('\n=== Test 4 : payload invalide, admin associé → 400 attendu (avant tout appel Meta) ===')
    const badPayloadAuthed = await postSync(0, cookieHeader)
    console.log(`Statut : ${badPayloadAuthed.status}`, badPayloadAuthed.body)
    if (badPayloadAuthed.status !== 400) throw new Error(`Anomalie : statut ${badPayloadAuthed.status} au lieu de 400.`)

    console.log('\n✅ Tous les cas HTTP (401, 403, 200, 400) confirmés.')
  } finally {
    await adminSupabase.auth.admin.deleteUser(testUserId)
    console.log('\nUtilisateur de test supprimé (profil supprimé en cascade).')
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
