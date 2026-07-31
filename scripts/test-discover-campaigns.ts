// Script local, jetable : teste discoverCampaignNumbers() sur la campagne
// Meta maître configurée dans .env. Lecture Meta uniquement (GET) — aucune
// écriture Supabase, aucune synchro déclenchée. Lance avec
// `npx tsx scripts/test-discover-campaigns.ts`.

import { readFileSync } from 'node:fs'
import { discoverCampaignNumbers } from '../lib/sync/discoverCampaigns'

const REQUIRED_VARS = ['META_ACCESS_TOKEN', 'META_API_VERSION', 'META_CAMPAIGN_ID'] as const

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

  const metaCampaignId = process.env.META_CAMPAIGN_ID as string

  console.log(`=== Détection des numéros de campagne — campagne maître ${metaCampaignId} ===`)
  const result = await discoverCampaignNumbers(metaCampaignId)

  console.log(`\nNuméros valides (triés, ${result.valid.length}) : ${result.valid.join(', ') || '(aucun)'}`)

  if (result.invalid.length > 0) {
    console.log(`\nGroupes invalides (${result.invalid.length}) :`)
    result.invalid.forEach((group) => {
      console.log(`  • n°${group.campaignNumber} : ${group.reason}`)
    })
  } else {
    console.log('\nAucun groupe invalide.')
  }

  const uniqueCheck = new Set(result.valid)
  if (uniqueCheck.size !== result.valid.length) {
    throw new Error('Anomalie : doublon détecté dans les numéros valides.')
  }

  const sortedCheck = [...result.valid].sort((a, b) => a - b)
  if (JSON.stringify(sortedCheck) !== JSON.stringify(result.valid)) {
    throw new Error('Anomalie : la liste des numéros valides n\'est pas triée par ordre croissant.')
  }

  console.log('\n✅ Détection terminée : aucun doublon, ordre croissant confirmé. Aucune écriture effectuée.')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
