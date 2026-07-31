// Script local, jetable : exécute syncAllCampaigns() deux fois de suite sur la
// campagne Meta maître configurée dans .env, et vérifie l'idempotence globale
// (mêmes ids campagne/audiences/vidéos aux deux runs, 1/2/2 par campagne,
// champs Calendly jamais écrasés, un sync_run par tentative réelle). Écrit
// réellement dans Supabase (service role) — Meta reste en lecture seule.
// Lance avec `npx tsx scripts/test-sync-all-campaigns.ts`.

import { readFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'
import { syncAllCampaigns } from '../lib/sync/syncAllCampaigns'

const REQUIRED_VARS = [
  'META_ACCESS_TOKEN',
  'META_API_VERSION',
  'META_CAMPAIGN_ID',
  'LEAD_ACTION_TYPE',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

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

function printReport(label: string, report: Awaited<ReturnType<typeof syncAllCampaigns>>): void {
  console.log(`\n--- ${label} ---`)
  console.log(
    `Total détecté : ${report.totalDetected} · Succès : ${report.succeeded} · Échecs : ${report.failed} · ` +
      `Groupes invalides : ${report.invalid.length}`
  )
  report.invalid.forEach((group) => console.log(`  invalide n°${group.campaignNumber} : ${group.reason}`))
  report.details.forEach((detail) => {
    if (detail.status === 'success') {
      console.log(
        `  n°${detail.campaignNumber} succès : campagne=${detail.result.campaign.id} ` +
          `audiences=${detail.result.audiences.length} vidéos=${detail.result.videos.length}`
      )
    } else {
      console.log(`  n°${detail.campaignNumber} échec : ${detail.message}`)
    }
  })
}

async function main(): Promise<void> {
  loadEnvFile('.env')
  loadEnvFile('.env.local')
  assertRequiredEnv()

  const supabase = createAdminClient()
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', CLIENT_SLUG)
    .single()
  if (clientError || !client) {
    throw new Error(`Client "${CLIENT_SLUG}" introuvable (${clientError?.message ?? 'aucune ligne'}).`)
  }

  const params = {
    clientId: client.id,
    metaCampaignId: process.env.META_CAMPAIGN_ID as string,
    leadActionType: process.env.LEAD_ACTION_TYPE as string,
  }

  const { count: syncRunsBefore } = await supabase
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)

  console.log('=== Run 1 : syncAllCampaigns() ===')
  const run1 = await syncAllCampaigns(params)
  printReport('Run 1', run1)

  if (run1.succeeded + run1.failed !== run1.totalDetected) {
    throw new Error('Anomalie : succès + échecs ≠ total détecté (run 1).')
  }
  if (run1.failed > 0) {
    throw new Error(`${run1.failed} campagne(s) réelle(s) en échec au run 1 — voir détail ci-dessus.`)
  }

  console.log('\n=== Run 2 : syncAllCampaigns() — doit être idempotent ===')
  const run2 = await syncAllCampaigns(params)
  printReport('Run 2', run2)

  if (run2.succeeded + run2.failed !== run2.totalDetected) {
    throw new Error('Anomalie : succès + échecs ≠ total détecté (run 2).')
  }
  if (run2.failed > 0) {
    throw new Error(`${run2.failed} campagne(s) réelle(s) en échec au run 2 — voir détail ci-dessus.`)
  }
  if (run1.totalDetected !== run2.totalDetected) {
    throw new Error(`Anomalie : total détecté différent entre les runs (${run1.totalDetected} vs ${run2.totalDetected}).`)
  }

  console.log('\n=== Vérification idempotence : mêmes ids entre run 1 et run 2, par campagne ===')
  for (const d1 of run1.details) {
    const d2 = run2.details.find((d) => d.campaignNumber === d1.campaignNumber)
    if (!d2 || d1.status !== 'success' || d2.status !== 'success') {
      throw new Error(`Anomalie : comparaison impossible pour la campagne n°${d1.campaignNumber}.`)
    }
    if (d1.result.campaign.id !== d2.result.campaign.id) {
      throw new Error(`Anomalie : id de campagne différent pour n°${d1.campaignNumber} entre les deux runs.`)
    }
    const audiences1 = new Set(d1.result.audiences.map((a) => a.id))
    const audiences2 = new Set(d2.result.audiences.map((a) => a.id))
    if (audiences1.size !== 2 || audiences2.size !== 2 || [...audiences1].some((id) => !audiences2.has(id))) {
      throw new Error(`Anomalie : audiences incohérentes pour la campagne n°${d1.campaignNumber}.`)
    }
    const videos1 = new Set(d1.result.videos.map((v) => v.id))
    const videos2 = new Set(d2.result.videos.map((v) => v.id))
    if (videos1.size !== 2 || videos2.size !== 2 || [...videos1].some((id) => !videos2.has(id))) {
      throw new Error(`Anomalie : vidéos incohérentes pour la campagne n°${d1.campaignNumber}.`)
    }
    console.log(`  n°${d1.campaignNumber} : ids identiques aux deux runs (1 campagne / 2 audiences / 2 vidéos).`)
  }

  console.log('\n=== Comptages en base par campagne (après run 2) ===')
  for (const detail of run2.details) {
    if (detail.status !== 'success') continue
    const { count: campaignCount } = await supabase
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('campaign_number', detail.campaignNumber)
    const { count: audienceCount } = await supabase
      .from('audiences')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', detail.result.campaign.id)
    const { count: videoCount } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .in(
        'audience_id',
        detail.result.audiences.map((a) => a.id)
      )

    console.log(`  n°${detail.campaignNumber} : campagnes=${campaignCount} audiences=${audienceCount} vidéos=${videoCount}`)
    if (campaignCount !== 1 || audienceCount !== 2 || videoCount !== 2) {
      throw new Error(`Comptages non conformes pour la campagne n°${detail.campaignNumber}.`)
    }
  }

  console.log('\n=== Champs Calendly/manuels (ne doivent jamais être écrasés) ===')
  for (const detail of run2.details) {
    if (detail.status !== 'success') continue
    console.log(
      `  n°${detail.campaignNumber} : calendly_appointments=${detail.result.campaign.calendly_appointments} ` +
        `manual_appointments_adjustment=${detail.result.campaign.manual_appointments_adjustment}`
    )
  }

  const { count: syncRunsAfter } = await supabase
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)

  const expectedDelta = run1.totalDetected + run2.totalDetected
  const actualDelta = (syncRunsAfter ?? 0) - (syncRunsBefore ?? 0)
  console.log(
    `\nsync_runs avant=${syncRunsBefore} après=${syncRunsAfter} (delta=${actualDelta}, attendu=${expectedDelta} : ` +
      `1 par campagne réellement tentée, aucun pour les groupes invalides)`
  )
  if (actualDelta !== expectedDelta) {
    throw new Error(`Anomalie : delta sync_runs (${actualDelta}) ≠ tentatives réelles attendues (${expectedDelta}).`)
  }

  console.log('\n✅ Synchro globale idempotente confirmée : aucun doublon, comptages 1/2/2, Calendly intact.')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
