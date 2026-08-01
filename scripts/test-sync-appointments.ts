// Script local, jetable : exécute syncAppointments() deux fois de suite pour
// le client configuré et vérifie que la synchro est réellement différentielle
// (2e run sans changement Calendly ⇒ created=0, updated=0, skipped=lus),
// sans doublon en base et campaign_id toujours null. Écrit réellement dans
// Supabase (service role) — Calendly reste en lecture seule (voir
// lib/calendly/appointments.ts). Lance avec
// `npx tsx scripts/test-sync-appointments.ts`.

import { readFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'
import { syncAppointments } from '../lib/sync/syncAppointments'

const REQUIRED_VARS = ['CALENDLY_ACCESS_TOKEN', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

const CLIENT_SLUG = 'formation-barbier'

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

function printResult(label: string, result: Awaited<ReturnType<typeof syncAppointments>>): void {
  console.log(`\n--- ${label} ---`)
  console.log(
    `lus=${result.read} créés=${result.created} mis à jour=${result.updated} ignorés=${result.skipped} erreurs=${result.errors}`
  )
  if (result.errorDetails.length > 0) {
    console.log('Détail des erreurs :')
    result.errorDetails.forEach((message) => console.log(`  - ${message}`))
  }
}

async function main(): Promise<void> {
  loadEnvFile('.env')
  loadEnvFile('.env.local')
  assertRequiredEnv()

  const supabase = createAdminClient()
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, slug')
    .eq('slug', CLIENT_SLUG)
    .single()

  if (clientError || !client) {
    throw new Error(
      `Client "${CLIENT_SLUG}" introuvable en base (${clientError?.message ?? 'aucune ligne'}). ` +
        'Vérifier supabase/seed.sql a bien été appliqué.'
    )
  }

  console.log('=== Run 1 : syncAppointments ===')
  const run1 = await syncAppointments(client.id)
  printResult('Run 1', run1)

  if (run1.created + run1.updated + run1.skipped !== run1.read) {
    throw new Error(
      `Anomalie run 1 : créés+mis à jour+ignorés (${run1.created + run1.updated + run1.skipped}) ` +
        `≠ lus (${run1.read}).`
    )
  }

  console.log('\n=== Run 2 : syncAppointments — sans changement Calendly, doit être un no-op ===')
  const run2 = await syncAppointments(client.id)
  printResult('Run 2', run2)

  if (run2.created !== 0 || run2.updated !== 0) {
    throw new Error(
      `Anomalie : le run 2 a créé ${run2.created} et mis à jour ${run2.updated} ligne(s) au lieu de 0 ` +
        '(la synchro devrait être un no-op sans changement Calendly).'
    )
  }
  if (run2.skipped !== run2.read) {
    throw new Error(`Anomalie : le run 2 a ignoré ${run2.skipped} ligne(s) au lieu de ${run2.read} (lus).`)
  }

  // Comptages exacts (head: true) plutôt qu'un select() de toutes les lignes :
  // PostgREST plafonne silencieusement les résultats select() (max-rows par
  // défaut), ce qui tronquerait le total sur ce volume (1145 rendez-vous).
  // calendly_event_uri est de toute façon contrainte unique en base
  // (migration 20260801000000_appointments.sql) : un doublon est donc
  // impossible par construction, pas seulement vérifié ici.
  const { count: total, error: totalError } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)

  const { count: withCampaign, error: withCampaignError } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .not('campaign_id', 'is', null)

  const { count: withChannel, error: withChannelError } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .not('acquisition_channel', 'is', null)

  if (totalError || withCampaignError || withChannelError) {
    throw new Error('Échec des requêtes de comptage post-synchro.')
  }

  if ((withCampaign ?? 0) > 0) {
    throw new Error(`Anomalie : ${withCampaign} rendez-vous ont campaign_id non nul (doit toujours être null).`)
  }

  console.log('\n=== Comptages en base après le 2e run ===')
  console.log(`Rendez-vous (client=${CLIENT_SLUG}) : ${total}`)
  console.log(`  dont avec acquisition_channel renseigné : ${withChannel}`)
  console.log(`  dont campaign_id non nul : ${withCampaign} (attendu : 0)`)

  if (total !== run2.read) {
    throw new Error(`Anomalie : total en base (${total}) ne correspond pas aux rendez-vous lus (${run2.read}).`)
  }

  console.log(
    '\n✅ Synchro réellement différentielle confirmée : run 2 sans création ni mise à jour ' +
      `(${run2.skipped} ignorés = identiques), total en base stable, campaign_id toujours null.`
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
