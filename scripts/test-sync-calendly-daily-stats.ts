// Script local, jetable : valide syncCalendlyDailyStats() en conditions
// réelles. Renseigne temporairement une vraie fenêtre de dates sur la
// campagne témoin n°19 (même fenêtre 2026-06-30 → 2026-07-17, Europe/Paris,
// que scripts/test-sync-appointments.ts), lance syncAppointments() (existant,
// non modifié) pour rattacher de vrais rendez-vous, puis syncCalendlyDailyStats()
// et vérifie : somme journalière = total rendez-vous actifs rattachés,
// colonnes Meta (meta_spend/meta_pixel_leads) inchangées, rejeu idempotent
// (aucun doublon, aucune valeur qui bouge), puis restaure intégralement
// (end_date -> null, rendez-vous détachés, compteurs journaliers remis à 0
// par la synchro elle-même — pas de DELETE/UPDATE manuel). Écrit réellement
// dans Supabase (service role) — Calendly reste en lecture seule. Lance avec
// `npx tsx scripts/test-sync-calendly-daily-stats.ts`.

import { readFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'
import { syncAppointments } from '../lib/sync/syncAppointments'
import { syncCalendlyDailyStats } from '../lib/sync/syncCalendlyDailyStats'

const REQUIRED_VARS = ['CALENDLY_ACCESS_TOKEN', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

const CLIENT_SLUG = 'formation-barbier'
const CAMPAIGN_NUMBER = 19
const TEMP_END_DATE = '2026-07-17'

type Supa = ReturnType<typeof createAdminClient>

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

async function getCampaign(supabase: Supa, clientId: string, campaignNumber: number) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, end_date, meta_spend, meta_pixel_leads')
    .eq('client_id', clientId)
    .eq('campaign_number', campaignNumber)
    .single()
  if (error || !data) {
    throw new Error(`Campagne n°${campaignNumber} introuvable (${error?.message ?? 'aucune ligne'}).`)
  }
  return data
}

async function setCampaignEndDate(supabase: Supa, campaignId: string, endDate: string | null): Promise<void> {
  const { error } = await supabase.from('campaigns').update({ end_date: endDate }).eq('id', campaignId)
  if (error) throw new Error(`Échec mise à jour end_date campagne ${campaignId} : ${error.message}`)
}

async function countActiveAttached(supabase: Supa, campaignId: string): Promise<number> {
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'active')
  if (error) throw new Error(`Échec comptage rendez-vous actifs rattachés : ${error.message}`)
  return count ?? 0
}

type DailyRow = { id: string; stat_date: string; meta_spend: number; meta_pixel_leads: number; calendly_appointments: number }

async function getDailyRows(supabase: Supa, campaignId: string): Promise<DailyRow[]> {
  const { data, error } = await supabase
    .from('campaign_daily_stats')
    .select('id, stat_date, meta_spend, meta_pixel_leads, calendly_appointments')
    .eq('campaign_id', campaignId)
    .order('stat_date', { ascending: true })
  if (error) throw new Error(`Échec lecture campaign_daily_stats : ${error.message}`)
  return data ?? []
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

  const campaign = await getCampaign(supabase, client.id, CAMPAIGN_NUMBER)
  const originalEndDate = campaign.end_date

  console.log(`=== Baseline : campagne n°${CAMPAIGN_NUMBER} end_date=${originalEndDate ?? 'null'} ===`)
  const baselineDailyRows = await getDailyRows(supabase, campaign.id)
  const baselineMetaByDate = new Map(baselineDailyRows.map((r) => [r.stat_date, { spend: r.meta_spend, leads: r.meta_pixel_leads }]))
  console.log(
    `${baselineDailyRows.length} ligne(s) campaign_daily_stats existante(s) pour cette campagne ` +
      `(colonnes Meta à préserver telles quelles).`
  )

  try {
    console.log(
      `\n════════ Fenêtre réelle temporaire : campagne n°${CAMPAIGN_NUMBER} end_date -> ${TEMP_END_DATE} ════════`
    )
    await setCampaignEndDate(supabase, campaign.id, TEMP_END_DATE)

    console.log('\n=== syncAppointments() — rattache les rendez-vous réels à la fenêtre ===')
    const appointmentsSync = await syncAppointments(client.id)
    console.log(
      `lus=${appointmentsSync.read} créés=${appointmentsSync.created} mis à jour=${appointmentsSync.updated} ` +
        `attribués=${appointmentsSync.campaignsAssigned}`
    )

    const activeAttached = await countActiveAttached(supabase, campaign.id)
    console.log(`Rendez-vous actifs rattachés à la campagne n°${CAMPAIGN_NUMBER} (base) : ${activeAttached}`)
    if (activeAttached === 0) {
      throw new Error('Anomalie : aucun rendez-vous rattaché — la fenêtre témoin ne produit plus de données réelles.')
    }

    console.log('\n=== Run 1 : syncCalendlyDailyStats() ===')
    const run1 = await syncCalendlyDailyStats(client.id)
    console.log(
      `daysWritten=${run1.daysWritten} daysWithAppointments=${run1.daysWithAppointments} daysZeroed=${run1.daysZeroed}`
    )

    const dailyRows1 = await getDailyRows(supabase, campaign.id)
    console.log(`\n=== Comptages journaliers Calendly (${dailyRows1.length} jours) ===`)
    dailyRows1.forEach((row) => {
      console.log(
        `  ${row.stat_date} : calendly_appointments=${row.calendly_appointments} ` +
          `(meta_spend=${row.meta_spend} meta_pixel_leads=${row.meta_pixel_leads})`
      )
    })

    const sumCalendly = dailyRows1.reduce((sum, r) => sum + r.calendly_appointments, 0)
    console.log('\n=== Contrôle sommes : total journalier Calendly vs rendez-vous actifs rattachés ===')
    console.log(`Somme journalière calendly_appointments=${sumCalendly} · rendez-vous actifs rattachés=${activeAttached}`)
    if (sumCalendly !== activeAttached) {
      throw new Error(`Anomalie : somme journalière (${sumCalendly}) ≠ rendez-vous actifs rattachés (${activeAttached}).`)
    }
    console.log('✅ Somme journalière conforme au total des rendez-vous actifs rattachés.')

    console.log('\n=== Contrôle colonnes Meta (doivent rester strictement inchangées) ===')
    let metaUntouched = true
    for (const row of dailyRows1) {
      const before = baselineMetaByDate.get(row.stat_date)
      if (before && (before.spend !== row.meta_spend || before.leads !== row.meta_pixel_leads)) {
        metaUntouched = false
        console.log(
          `  ⚠️ ${row.stat_date} : meta_spend/meta_pixel_leads modifiés (avant=${before.spend}/${before.leads}, ` +
            `après=${row.meta_spend}/${row.meta_pixel_leads})`
        )
      }
    }
    if (!metaUntouched) {
      throw new Error('Anomalie CRITIQUE : au moins une colonne Meta a été modifiée par la synchro Calendly.')
    }
    console.log(`✅ Colonnes Meta inchangées sur les ${baselineDailyRows.length} jour(s) déjà existants avant le test.`)

    console.log('\n=== Run 2 : syncCalendlyDailyStats() — doit être idempotent ===')
    const run2 = await syncCalendlyDailyStats(client.id)
    console.log(
      `daysWritten=${run2.daysWritten} daysWithAppointments=${run2.daysWithAppointments} daysZeroed=${run2.daysZeroed}`
    )

    const dailyRows2 = await getDailyRows(supabase, campaign.id)
    if (dailyRows2.length !== dailyRows1.length) {
      throw new Error(
        `Anomalie CRITIQUE : nombre de lignes différent après rejeu (${dailyRows1.length} -> ${dailyRows2.length}) — doublon probable.`
      )
    }
    const ids1 = new Set(dailyRows1.map((r) => r.id))
    const ids2 = new Set(dailyRows2.map((r) => r.id))
    if ([...ids1].some((id) => !ids2.has(id))) {
      throw new Error('Anomalie CRITIQUE : les ids des lignes journalières diffèrent entre les deux runs.')
    }
    const valuesChanged = dailyRows1.some((r1) => {
      const r2 = dailyRows2.find((r) => r.id === r1.id)
      return !r2 || r2.calendly_appointments !== r1.calendly_appointments || r2.meta_spend !== r1.meta_spend || r2.meta_pixel_leads !== r1.meta_pixel_leads
    })
    if (valuesChanged) {
      throw new Error('Anomalie : au moins une valeur a changé entre les deux runs alors qu\'aucune donnée source n\'a bougé.')
    }
    console.log('✅ Rejeu idempotent : mêmes ids, mêmes valeurs (Calendly et Meta), aucun doublon.')
  } finally {
    // Filet de sécurité : restaure toujours end_date à sa valeur d'origine
    // constatée en base, puis redétache les rendez-vous via la même synchro
    // différentielle que la production (pas d'UPDATE manuel sur appointments),
    // puis remet à 0 les compteurs journaliers désormais sans rendez-vous —
    // toujours via syncCalendlyDailyStats() elle-même (pas de DELETE manuel).
    console.log(`\n════════ Restauration : campagne n°${CAMPAIGN_NUMBER} end_date -> ${originalEndDate ?? 'null'} ════════`)
    await setCampaignEndDate(supabase, campaign.id, originalEndDate)

    const restoreAppointments = await syncAppointments(client.id)
    console.log(
      `syncAppointments (restauration) : mis à jour=${restoreAppointments.updated} ` +
        `désattribués=${restoreAppointments.campaignsUnassigned}`
    )

    const remainingAttached = await countActiveAttached(supabase, campaign.id)
    console.log(`Rendez-vous actifs encore rattachés après restauration : ${remainingAttached} (attendu 0)`)
    if (remainingAttached !== 0) {
      console.error(`Échec restauration : ${remainingAttached} rendez-vous restent rattachés.`)
    }

    const restoreDailyStats = await syncCalendlyDailyStats(client.id)
    console.log(
      `syncCalendlyDailyStats (restauration) : daysWritten=${restoreDailyStats.daysWritten} ` +
        `daysWithAppointments=${restoreDailyStats.daysWithAppointments} daysZeroed=${restoreDailyStats.daysZeroed}`
    )

    const finalDailyRows = await getDailyRows(supabase, campaign.id)
    const finalSumCalendly = finalDailyRows.reduce((sum, r) => sum + r.calendly_appointments, 0)
    console.log(`Somme calendly_appointments après restauration : ${finalSumCalendly} (attendu 0)`)
    if (finalSumCalendly !== 0) {
      console.error(`Échec restauration : somme calendly_appointments = ${finalSumCalendly} (attendu 0).`)
    }

    let finalMetaUntouched = true
    for (const row of finalDailyRows) {
      const before = baselineMetaByDate.get(row.stat_date)
      if (before && (before.spend !== row.meta_spend || before.leads !== row.meta_pixel_leads)) {
        finalMetaUntouched = false
      }
    }
    console.log(`Colonnes Meta toujours inchangées après restauration : ${finalMetaUntouched}`)

    if (remainingAttached === 0 && finalSumCalendly === 0 && finalMetaUntouched) {
      console.log('✅ Restauration complète confirmée : 0 rendez-vous rattaché, 0 compteur Calendly résiduel, Meta intact.')
    } else {
      throw new Error('Restauration incomplète — voir anomalies ci-dessus.')
    }
  }

  console.log(
    '\n✅ syncCalendlyDailyStats validée en conditions réelles : somme journalière = rendez-vous actifs rattachés, ' +
      'colonnes Meta jamais écrasées, rejeu idempotent, restauration complète.'
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
