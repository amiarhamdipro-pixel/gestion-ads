// Script local, jetable : exécute syncCampaign() deux fois de suite sur la
// campagne configurée dans .env (META_CAMPAIGN_ID / CAMPAIGN_NUMBER) et vérifie
// l'idempotence en base (1 campagne, 2 audiences, 2 vidéos, mêmes ids aux deux
// runs, aucun champ Calendly touché). Écrit réellement dans Supabase (service
// role) — Meta reste en lecture seule. Lance avec `npx tsx scripts/test-sync-campaign.ts`.

import { readFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'
import { syncCampaign } from '../lib/sync/syncCampaign'

const REQUIRED_VARS = [
  'META_ACCESS_TOKEN',
  'META_API_VERSION',
  'META_CAMPAIGN_ID',
  'CAMPAIGN_NUMBER',
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

function parseCampaignNumber(): number {
  const raw = process.env.CAMPAIGN_NUMBER as string
  const value = Number(raw)
  if (!Number.isInteger(value)) {
    throw new Error(`CAMPAIGN_NUMBER invalide : "${raw}" n'est pas un entier.`)
  }
  return value
}

function printResult(label: string, result: Awaited<ReturnType<typeof syncCampaign>>): void {
  console.log(`\n--- ${label} ---`)
  console.log(
    `Campagne : id=${result.campaign.id} name="${result.campaign.name}" status=${result.campaign.status} ` +
      `start=${result.campaign.start_date} end=${result.campaign.end_date} ` +
      `spend=${result.campaign.meta_spend} leads=${result.campaign.meta_pixel_leads}`
  )
  console.log(
    `Calendly (ne doit jamais être modifié ici) : calendly_appointments=${result.campaign.calendly_appointments} ` +
      `manual_appointments_adjustment=${result.campaign.manual_appointments_adjustment}`
  )
  for (const audience of result.audiences) {
    console.log(
      `Audience ${audience.audience_type} : id=${audience.id} meta_adset_id=${audience.meta_adset_id} ` +
        `spend=${audience.meta_spend} leads=${audience.meta_pixel_leads}`
    )
  }
  for (const video of result.videos) {
    console.log(
      `Vidéo : id=${video.id} meta_ad_id=${video.meta_ad_id} impressions=${video.impressions} ` +
        `plays=${video.video_plays} thruplays=${video.thruplays}`
    )
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

  const params = {
    clientId: client.id,
    metaCampaignId: process.env.META_CAMPAIGN_ID as string,
    campaignNumber: parseCampaignNumber(),
    leadActionType: process.env.LEAD_ACTION_TYPE as string,
  }

  const { data: priorSyncRuns, error: priorSyncRunsError } = await supabase
    .from('sync_runs')
    .select('id')
    .eq('client_id', client.id)

  if (priorSyncRunsError || !priorSyncRuns) {
    throw new Error(`Échec lecture sync_runs (état initial) : ${priorSyncRunsError?.message ?? 'réponse vide'}`)
  }
  const priorSyncRunIds = new Set(priorSyncRuns.map((r) => r.id))

  console.log(`=== Run 1 : syncCampaign(n°${params.campaignNumber}) ===`)
  const run1 = await syncCampaign(params)
  printResult('Run 1', run1)

  console.log(`\n=== Run 2 : syncCampaign(n°${params.campaignNumber}) — doit être idempotent ===`)
  const run2 = await syncCampaign(params)
  printResult('Run 2', run2)

  if (run1.campaign.id !== run2.campaign.id) {
    throw new Error('Anomalie : la campagne a changé d\'id entre les deux runs (nouvelle ligne créée).')
  }

  const run1AudienceIds = new Set(run1.audiences.map((a) => a.id))
  const run2AudienceIds = new Set(run2.audiences.map((a) => a.id))
  if (run1AudienceIds.size !== 2 || run2AudienceIds.size !== 2) {
    throw new Error(`Anomalie : nombre d'audiences inattendu (run1=${run1AudienceIds.size}, run2=${run2AudienceIds.size}).`)
  }
  if ([...run1AudienceIds].some((id) => !run2AudienceIds.has(id))) {
    throw new Error('Anomalie : les ids des audiences diffèrent entre les deux runs (doublon probable).')
  }

  const run1VideoIds = new Set(run1.videos.map((v) => v.id))
  const run2VideoIds = new Set(run2.videos.map((v) => v.id))
  if (run1VideoIds.size !== 2 || run2VideoIds.size !== 2) {
    throw new Error(`Anomalie : nombre de vidéos inattendu (run1=${run1VideoIds.size}, run2=${run2VideoIds.size}).`)
  }
  if ([...run1VideoIds].some((id) => !run2VideoIds.has(id))) {
    throw new Error('Anomalie : les ids des vidéos diffèrent entre les deux runs (doublon probable).')
  }

  const { count: campaignCount, error: campaignCountError } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .eq('campaign_number', params.campaignNumber)

  const { count: audienceCount, error: audienceCountError } = await supabase
    .from('audiences')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', run2.campaign.id)

  const { count: videoCount, error: videoCountError } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .in(
      'audience_id',
      run2.audiences.map((a) => a.id)
    )

  if (campaignCountError || audienceCountError || videoCountError) {
    throw new Error('Échec des requêtes de comptage post-synchro.')
  }

  console.log('\n=== Comptages en base après le 2e run ===')
  console.log(`Campagnes (client=${CLIENT_SLUG}, n°${params.campaignNumber}) : ${campaignCount}`)
  console.log(`Audiences (de cette campagne) : ${audienceCount}`)
  console.log(`Vidéos (de ces audiences) : ${videoCount}`)

  if (campaignCount !== 1 || audienceCount !== 2 || videoCount !== 2) {
    throw new Error(
      `Comptages non conformes : campagnes=${campaignCount} (1 attendu), audiences=${audienceCount} (2 attendues), ` +
        `vidéos=${videoCount} (2 attendues).`
    )
  }

  console.log('\n✅ Synchro idempotente confirmée : mêmes ids aux deux runs, comptages exacts, aucun doublon.')

  const bogusNumber = 999999
  console.log(`\n=== Run 3 : syncCampaign(n°${bogusNumber}) — doit échouer proprement ===`)
  try {
    await syncCampaign({ ...params, campaignNumber: bogusNumber })
    throw new Error(`Anomalie : le numéro "${bogusNumber}" aurait dû échouer et ne l'a pas fait.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`✅ Erreur attendue reçue côté appelant : ${message}`)
  }

  const { data: syncRuns, error: syncRunsError } = await supabase
    .from('sync_runs')
    .select('id, status, error_message, started_at, finished_at')
    .eq('client_id', client.id)
    .order('started_at', { ascending: true })

  if (syncRunsError || !syncRuns) {
    throw new Error(`Échec lecture sync_runs : ${syncRunsError?.message ?? 'réponse vide'}`)
  }

  const newSyncRuns = syncRuns.filter((r) => !priorSyncRunIds.has(r.id))

  console.log(
    `\n=== sync_runs créés par cette session (${newSyncRuns.length} nouvelles lignes sur ${syncRuns.length} au total, historique ignoré) ===`
  )
  newSyncRuns.forEach((run, index) => {
    console.log(`  [${index + 1}] id=${run.id} status=${run.status} message="${run.error_message}"`)
  })

  const successCount = newSyncRuns.filter((r) => r.status === 'success').length
  const failedCount = newSyncRuns.filter((r) => r.status === 'failed').length
  if (successCount !== 2 || failedCount !== 1) {
    throw new Error(
      `Journalisation incomplète : ${successCount} succès (2 attendus), ${failedCount} échec (1 attendu) parmi les nouvelles lignes.`
    )
  }

  const successWithMessage = newSyncRuns.find((r) => r.status === 'success' && r.error_message !== null)
  if (successWithMessage) {
    throw new Error(`Anomalie : sync_run ${successWithMessage.id} en succès a un error_message non nul.`)
  }

  const failedWithoutMessage = newSyncRuns.find((r) => r.status === 'failed' && !r.error_message)
  if (failedWithoutMessage) {
    throw new Error(`Anomalie : sync_run ${failedWithoutMessage.id} en échec n'a pas de error_message.`)
  }

  console.log('\n✅ Chaque tentative de cette session (2 réussies, 1 échouée) a produit une ligne sync_runs distincte.')
  console.log('✅ error_message est null en succès et renseigné en échec (nouvelles lignes uniquement).')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
