// Script local, jetable : vérifie syncCampaignDailyStats() (une campagne
// témoin, CAMPAIGN_NUMBER de .env) puis syncAllCampaignsDailyStats() (toutes
// les campagnes valides détectées, typiquement 12 à 20). Écrit réellement
// dans Supabase (service role) — Meta reste en lecture seule (GET uniquement,
// voir lib/sync/meta.ts). Vérifie : idempotence (rejeu sans doublon), sommes
// journalières = totaux campagne (rafraîchis via syncCampaign() avant
// comparaison, pour une base fraîche), et non-écrasement de
// calendly_appointments (valeur sentinelle posée manuellement, doit survivre
// à un rejeu). Un code Meta 17 (limite de débit) rencontré pendant l'étape
// "toutes les campagnes" est traité comme un arrêt normal, pas un échec du
// script. Lance avec `npx tsx scripts/test-sync-campaign-daily-stats.ts`.

import { readFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'
import { syncCampaign } from '../lib/sync/syncCampaign'
import { syncCampaignDailyStats } from '../lib/sync/syncCampaignDailyStats'
import { syncAllCampaignsDailyStats } from '../lib/sync/syncAllCampaignsDailyStats'

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
const SENTINEL_CALENDLY_APPOINTMENTS = 42

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

function roundEur(n: number): number {
  return Math.round(n * 100) / 100
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
    campaignNumber: parseCampaignNumber(),
    leadActionType: process.env.LEAD_ACTION_TYPE as string,
  }

  console.log(`\n════════ ÉTAPE 1 : campagne témoin n°${params.campaignNumber} ════════`)

  // Rafraîchit campaigns.meta_spend/meta_pixel_leads (lecture seule côté
  // Meta) juste avant de comparer aux sommes journalières, pour une base
  // fraîche au même instant.
  console.log('\n=== Rafraîchissement de la campagne (syncCampaign) ===')
  const campaignSync = await syncCampaign(params)
  console.log(
    `Campagne n°${params.campaignNumber} : id=${campaignSync.campaign.id} spend=${campaignSync.campaign.meta_spend} ` +
      `leads=${campaignSync.campaign.meta_pixel_leads} calendly_appointments=${campaignSync.campaign.calendly_appointments} ` +
      '(colonne de campaigns, distincte de celle de campaign_daily_stats)'
  )

  console.log('\n=== Run 1 : syncCampaignDailyStats() ===')
  const run1 = await syncCampaignDailyStats(params)
  console.log(`daysUpserted=${run1.daysUpserted}`)
  console.log('Dates :', run1.dates.join(', ') || '(aucune)')

  if (run1.daysUpserted === 0) {
    throw new Error(
      `Anomalie : aucune donnée journalière retournée par Meta pour la campagne n°${params.campaignNumber}.`
    )
  }

  const { data: dailyRows1, error: dailyRows1Error } = await supabase
    .from('campaign_daily_stats')
    .select('id, stat_date, meta_spend, meta_pixel_leads, calendly_appointments')
    .eq('campaign_id', run1.campaignId)
    .order('stat_date', { ascending: true })

  if (dailyRows1Error || !dailyRows1) {
    throw new Error(`Échec lecture campaign_daily_stats : ${dailyRows1Error?.message ?? 'réponse vide'}`)
  }

  console.log(`\n=== Comptages journaliers (${dailyRows1.length} jours) ===`)
  dailyRows1.forEach((row) => {
    console.log(
      `  ${row.stat_date} : spend=${row.meta_spend} leads=${row.meta_pixel_leads} calendly_appointments=${row.calendly_appointments}`
    )
  })

  // ─── Contrôle sommes : total journalier = total campagne ───────────────
  const sumSpend = roundEur(dailyRows1.reduce((sum, r) => sum + Number(r.meta_spend), 0))
  const sumLeads = dailyRows1.reduce((sum, r) => sum + r.meta_pixel_leads, 0)
  const campaignSpend = roundEur(campaignSync.campaign.meta_spend)
  const campaignLeads = campaignSync.campaign.meta_pixel_leads

  console.log('\n=== Contrôle sommes (journalier vs total campagne) ===')
  console.log(`Dépensé  : somme journalière=${sumSpend} € · total campagne=${campaignSpend} €`)
  console.log(`Leads    : somme journalière=${sumLeads} · total campagne=${campaignLeads}`)

  if (Math.abs(sumSpend - campaignSpend) > 0.01) {
    throw new Error(`Anomalie : somme journalière du dépensé (${sumSpend}) ≠ total campagne (${campaignSpend}).`)
  }
  if (sumLeads !== campaignLeads) {
    throw new Error(`Anomalie : somme journalière des leads (${sumLeads}) ≠ total campagne (${campaignLeads}).`)
  }
  console.log('✅ Sommes journalières conformes au total campagne.')

  // ─── Sentinelle calendly_appointments : posée manuellement, ne doit ────
  // jamais être écrasée par un rejeu de syncCampaignDailyStats (Meta-only).
  const sentinelRow = dailyRows1[0]
  console.log(
    `\n=== Pose d'une valeur sentinelle calendly_appointments=${SENTINEL_CALENDLY_APPOINTMENTS} ` +
      `sur ${sentinelRow.stat_date} (simule une future écriture Calendly) ===`
  )
  const { error: sentinelError } = await supabase
    .from('campaign_daily_stats')
    .update({ calendly_appointments: SENTINEL_CALENDLY_APPOINTMENTS })
    .eq('id', sentinelRow.id)
  if (sentinelError) {
    throw new Error(`Échec pose de la sentinelle : ${sentinelError.message}`)
  }

  console.log('\n=== Run 2 : syncCampaignDailyStats() — doit être idempotent ===')
  const run2 = await syncCampaignDailyStats(params)
  console.log(`daysUpserted=${run2.daysUpserted}`)

  if (run1.campaignId !== run2.campaignId) {
    throw new Error('Anomalie : campaignId différent entre les deux runs.')
  }
  if (run1.dates.length !== run2.dates.length) {
    throw new Error(
      `Anomalie : nombre de jours différent entre les runs (run1=${run1.dates.length}, run2=${run2.dates.length}).`
    )
  }

  const { data: dailyRows2, error: dailyRows2Error } = await supabase
    .from('campaign_daily_stats')
    .select('id, stat_date, meta_spend, meta_pixel_leads, calendly_appointments')
    .eq('campaign_id', run1.campaignId)
    .order('stat_date', { ascending: true })

  if (dailyRows2Error || !dailyRows2) {
    throw new Error(`Échec relecture campaign_daily_stats : ${dailyRows2Error?.message ?? 'réponse vide'}`)
  }

  console.log(`\n=== Idempotence : ${dailyRows2.length} lignes après run 2 (attendu ${dailyRows1.length}, mêmes ids) ===`)
  if (dailyRows2.length !== dailyRows1.length) {
    throw new Error(`Anomalie CRITIQUE : nombre de lignes différent après rejeu (doublon probable) : ${dailyRows1.length} -> ${dailyRows2.length}.`)
  }
  const ids1 = new Set(dailyRows1.map((r) => r.id))
  const ids2 = new Set(dailyRows2.map((r) => r.id))
  if ([...ids1].some((id) => !ids2.has(id))) {
    throw new Error('Anomalie CRITIQUE : les ids des lignes journalières diffèrent entre les deux runs.')
  }
  console.log('✅ Aucun doublon : mêmes ids, même nombre de lignes après le second run.')

  const sentinelAfter = dailyRows2.find((r) => r.id === sentinelRow.id)
  console.log(
    `\n=== Vérification calendly_appointments après rejeu : ${sentinelAfter?.calendly_appointments} ` +
      `(attendu ${SENTINEL_CALENDLY_APPOINTMENTS}, jamais écrasé par ce sync Meta-only) ===`
  )
  if (sentinelAfter?.calendly_appointments !== SENTINEL_CALENDLY_APPOINTMENTS) {
    throw new Error(
      `Anomalie CRITIQUE : calendly_appointments écrasé (attendu ${SENTINEL_CALENDLY_APPOINTMENTS}, ` +
        `obtenu ${sentinelAfter?.calendly_appointments}).`
    )
  }
  console.log('✅ calendly_appointments jamais écrasé par la synchro Meta.')

  // Nettoyage de la sentinelle (retour à l'état neutre, cohérent avec le
  // reste du dépôt : ne pas laisser de donnée de test en base).
  const { error: cleanupError } = await supabase
    .from('campaign_daily_stats')
    .update({ calendly_appointments: 0 })
    .eq('id', sentinelRow.id)
  if (cleanupError) {
    console.error(`Échec nettoyage sentinelle (non bloquant) : ${cleanupError.message}`)
  } else {
    console.log('Sentinelle nettoyée (calendly_appointments remis à 0).')
  }

  console.log('\n════════ ÉTAPE 2 : toutes les campagnes valides (syncAllCampaignsDailyStats) ════════')
  const allParams = {
    clientId: client.id,
    metaCampaignId: process.env.META_CAMPAIGN_ID as string,
    leadActionType: process.env.LEAD_ACTION_TYPE as string,
  }

  const allReport = await syncAllCampaignsDailyStats(allParams)
  console.log(
    `\nTotal détecté=${allReport.totalDetected} succès=${allReport.succeeded} échecs=${allReport.failed} ` +
      `arrêt pour limite de débit=${allReport.stoppedOnRateLimit}`
  )
  allReport.details.forEach((detail) => {
    if (detail.status === 'success') {
      console.log(`  n°${detail.campaignNumber} : ${detail.result.daysUpserted} jour(s) upsertés.`)
    } else {
      console.log(`  n°${detail.campaignNumber} : échec — ${detail.message}`)
    }
  })

  if (allReport.stoppedOnRateLimit) {
    console.log(
      '\n⚠️  Arrêt anticipé sur code Meta 17 (limite de débit) — comportement attendu, pas un échec du script. ' +
        `${allReport.succeeded} campagne(s) synchronisée(s) avant l'arrêt.`
    )
  } else if (allReport.failed > 0) {
    throw new Error(`${allReport.failed} campagne(s) en échec pour une raison autre que le quota — voir détail ci-dessus.`)
  } else {
    console.log('\n✅ Toutes les campagnes valides synchronisées sans erreur.')
  }

  console.log('\n=== Run 2 (toutes campagnes) — vérification idempotence globale ===')
  const allReport2 = await syncAllCampaignsDailyStats(allParams)
  console.log(
    `Total détecté=${allReport2.totalDetected} succès=${allReport2.succeeded} échecs=${allReport2.failed} ` +
      `arrêt pour limite de débit=${allReport2.stoppedOnRateLimit}`
  )

  for (const d1 of allReport.details) {
    if (d1.status !== 'success') continue
    const d2 = allReport2.details.find((d) => d.campaignNumber === d1.campaignNumber)
    if (!d2 || d2.status !== 'success') continue // pas re-tentée au run 2 (arrêt quota) : pas comparable

    const { count } = await supabase
      .from('campaign_daily_stats')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', d1.result.campaignId)

    console.log(`  n°${d1.campaignNumber} : ${count} ligne(s) en base après le 2e run (jours run1=${d1.result.daysUpserted}, run2=${d2.result.daysUpserted})`)
    if (count !== d2.result.daysUpserted) {
      throw new Error(
        `Anomalie CRITIQUE : nombre de lignes en base (${count}) ≠ jours upsertés au run 2 (${d2.result.daysUpserted}) pour n°${d1.campaignNumber} — doublon probable.`
      )
    }
  }

  console.log('\n✅ Idempotence confirmée sur l\'ensemble des campagnes testées.')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
