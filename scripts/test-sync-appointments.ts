// Script local, jetable : valide le rattachement Calendly -> campagne en
// fuseau Europe/Paris. Deux temps :
// 1. Tests unitaires purs (données synthétiques, pas d'accès réseau/DB) sur
//    campaignsMatchingAppointment : dans une fenêtre, hors fenêtre,
//    chevauchement, bornes de journée hiver/été/changements d'heure.
// 2. Tests en conditions réelles sur le client configuré : renseigne
//    temporairement une vraie fenêtre de dates sur une campagne existante
//    (campagne n°19, cf. CAMPAIGN_NUMBER_A/B ci-dessous), lance la synchro,
//    vérifie les rattachements attendus, restaure end_date à sa valeur
//    d'origine et rejoue la synchro pour confirmer que campaign_id revient
//    à null (pas de UPDATE manuel sur appointments : la restauration passe
//    par la même synchro différentielle que la production). Même chose avec
//    deux campagnes (19 et 20) dont les fenêtres se chevauchent
//    temporairement, pour vérifier qu'aucune attribution arbitraire n'a
//    lieu. Écrit réellement dans Supabase (service role, table campaigns ET
//    appointments) — Calendly reste en lecture seule (voir
//    lib/calendly/appointments.ts). Lance avec
// `npx tsx scripts/test-sync-appointments.ts`.
//
// OBSOLÈTE (règle métier "une seule campagne dynamique par appel", voir
// BRIEF-CLAUDE-CODE.md et lib/sync/syncAppointments.ts) : syncAppointments()
// prend désormais un targetCampaignNumber explicite et ne rattache/réévalue
// plus qu'une seule campagne à la fois. Le Test 4 ci-dessous (chevauchement
// entre deux campagnes simultanément actives) ne peut plus se produire par
// construction — les appels sont adaptés pour compiler (CAMPAIGN_NUMBER_A
// comme cible), mais ce script n'a plus vocation à démontrer un vrai
// chevauchement. Par ailleurs CAMPAIGN_NUMBER_A=19 est désormais
// sync_locked=true (verrouillage définitif) : ce script prédate cette
// règle et n'a plus de résultat significatif tel quel sans reprise plus
// large, hors périmètre ici (le seul objectif de cette modification est de
// garder `npx tsc --noEmit` propre sur l'ensemble du projet).

import { readFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'
import { syncAppointments } from '../lib/sync/syncAppointments'
import { campaignsMatchingAppointment } from '../lib/calculations'

// Vérifie une borne de fenêtre : matchMs (instant UTC censé être dans la
// fenêtre) doit matcher, noMatchMs (1 seconde avant/après, côté extérieur)
// ne doit pas matcher. Les instants attendus sont calculés à la main
// (CET=UTC+1, CEST=UTC+2) pour ne pas dépendre du code testé.
function assertBoundary(label: string, campaign: { id: string; startDate: string; endDate: string }, matchIso: string, noMatchIso: string): void {
  const matched = campaignsMatchingAppointment([campaign], matchIso)
  const unmatched = campaignsMatchingAppointment([campaign], noMatchIso)
  if (matched.length !== 1 || unmatched.length !== 0) {
    throw new Error(
      `Test borne "${label}" échoué : matchIso=${matchIso} -> ${JSON.stringify(matched)}, ` +
        `noMatchIso=${noMatchIso} -> ${JSON.stringify(unmatched)}`
    )
  }
  console.log(`✅ Borne "${label}" correcte (fuseau Europe/Paris).`)
}

function testCampaignMatching(): void {
  console.log('=== Tests campaignsMatchingAppointment (données synthétiques, fuseau Europe/Paris) ===')

  const campaignA = { id: 'campaign-a', startDate: '2026-01-01', endDate: '2026-01-31' }
  const campaignB = { id: 'campaign-b', startDate: '2026-02-01', endDate: '2026-02-28' }
  const overlapping = { id: 'campaign-overlap', startDate: '2026-01-15', endDate: '2026-02-15' }

  // 2026-01-15T10:00:00Z = 2026-01-15T11:00 Paris (CET, hiver) : dans la fenêtre.
  const inWindow = campaignsMatchingAppointment([campaignA, campaignB], '2026-01-15T10:00:00Z')
  if (inWindow.length !== 1 || inWindow[0] !== 'campaign-a') {
    throw new Error(`Test "dans une fenêtre" échoué : ${JSON.stringify(inWindow)}`)
  }
  console.log('✅ Rendez-vous dans une fenêtre -> campagne correcte (campaign-a).')

  const outOfWindow = campaignsMatchingAppointment([campaignA, campaignB], '2026-03-15T10:00:00Z')
  if (outOfWindow.length !== 0) {
    throw new Error(`Test "hors fenêtre" échoué : ${JSON.stringify(outOfWindow)}`)
  }
  console.log('✅ Rendez-vous hors fenêtre -> aucune campagne (null).')

  const conflict = campaignsMatchingAppointment([campaignA, overlapping], '2026-01-20T10:00:00Z')
  if (conflict.length !== 2) {
    throw new Error(`Test "fenêtres chevauchantes" échoué : ${JSON.stringify(conflict)}`)
  }
  console.log(`✅ Rendez-vous en chevauchement -> ${conflict.length} campagnes candidates (erreur explicite attendue).`)

  // Hiver (CET = UTC+1) : 2026-01-15T00:00:00 Paris = 2026-01-14T23:00:00Z ;
  // 2026-01-15T23:59:59 Paris = 2026-01-15T22:59:59Z.
  const winterCampaign = { id: 'campaign-winter', startDate: '2026-01-15', endDate: '2026-01-15' }
  assertBoundary('hiver (CET) — début de journée', winterCampaign, '2026-01-14T23:00:00Z', '2026-01-14T22:59:59Z')
  assertBoundary('hiver (CET) — fin de journée', winterCampaign, '2026-01-15T22:59:59Z', '2026-01-15T23:00:00Z')

  // Été (CEST = UTC+2) : 2026-07-15T00:00:00 Paris = 2026-07-14T22:00:00Z ;
  // 2026-07-15T23:59:59 Paris = 2026-07-15T21:59:59Z.
  const summerCampaign = { id: 'campaign-summer', startDate: '2026-07-15', endDate: '2026-07-15' }
  assertBoundary('été (CEST) — début de journée', summerCampaign, '2026-07-14T22:00:00Z', '2026-07-14T21:59:59Z')
  assertBoundary('été (CEST) — fin de journée', summerCampaign, '2026-07-15T21:59:59Z', '2026-07-15T22:00:00Z')

  // Passage à l'heure d'été, 2026-03-29 (2h CET -> 3h CEST à 01:00 UTC) :
  // 00:00 Paris a lieu avant le changement (encore CET) = 2026-03-28T23:00:00Z ;
  // 23:59:59 Paris a lieu après (déjà CEST) = 2026-03-29T21:59:59Z.
  const springForwardCampaign = { id: 'campaign-spring', startDate: '2026-03-29', endDate: '2026-03-29' }
  assertBoundary(
    'passage heure d\'été — début de journée',
    springForwardCampaign,
    '2026-03-28T23:00:00Z',
    '2026-03-28T22:59:59Z'
  )
  assertBoundary(
    'passage heure d\'été — fin de journée',
    springForwardCampaign,
    '2026-03-29T21:59:59Z',
    '2026-03-29T22:00:00Z'
  )

  // Passage à l'heure d'hiver, 2026-10-25 (3h CEST -> 2h CET à 01:00 UTC) :
  // 00:00 Paris a lieu avant le changement (encore CEST) = 2026-10-24T22:00:00Z ;
  // 23:59:59 Paris a lieu après (déjà CET) = 2026-10-25T22:59:59Z.
  const fallBackCampaign = { id: 'campaign-fall', startDate: '2026-10-25', endDate: '2026-10-25' }
  assertBoundary(
    'passage heure d\'hiver — début de journée',
    fallBackCampaign,
    '2026-10-24T22:00:00Z',
    '2026-10-24T21:59:59Z'
  )
  assertBoundary(
    'passage heure d\'hiver — fin de journée',
    fallBackCampaign,
    '2026-10-25T22:59:59Z',
    '2026-10-25T23:00:00Z'
  )
}

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
  console.log(`campagne attribuée=${result.campaignsAssigned} campagne non attribuée=${result.campaignsUnassigned}`)
  if (result.errorDetails.length > 0) {
    console.log('Détail des erreurs :')
    result.errorDetails.forEach((message) => console.log(`  - ${message}`))
  }
}

// Deux campagnes réelles adjacentes de ce client, choisies parce que leurs
// fenêtres couvrent des rendez-vous Calendly réels vérifiés au préalable :
// ~60 rendez-vous entre le 2026-06-30 et le 2026-07-17 (Europe/Paris), et 4
// rendez-vous dans la zone de recouvrement 2026-07-18 → 2026-07-20 utilisée
// pour le test de chevauchement.
const CAMPAIGN_NUMBER_A = 19
const CAMPAIGN_NUMBER_B = 20

type Supa = ReturnType<typeof createAdminClient>

async function countTotal(supabase: Supa, clientId: string): Promise<number> {
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (error) throw new Error(`Échec comptage total appointments : ${error.message}`)
  return count ?? 0
}

async function countWithCampaign(supabase: Supa, clientId: string): Promise<number> {
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .not('campaign_id', 'is', null)
  if (error) throw new Error(`Échec comptage campaign_id non nul : ${error.message}`)
  return count ?? 0
}

async function countByCampaign(supabase: Supa, campaignId: string): Promise<number> {
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
  if (error) throw new Error(`Échec comptage par campagne : ${error.message}`)
  return count ?? 0
}

async function countInRange(supabase: Supa, clientId: string, startIso: string, endIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('start_time', startIso)
    .lte('start_time', endIso)
  if (error) throw new Error(`Échec comptage par plage : ${error.message}`)
  return count ?? 0
}

async function countInRangeWithCampaign(
  supabase: Supa,
  clientId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('start_time', startIso)
    .lte('start_time', endIso)
    .not('campaign_id', 'is', null)
  if (error) throw new Error(`Échec comptage par plage (attribué) : ${error.message}`)
  return count ?? 0
}

async function getCampaign(
  supabase: Supa,
  clientId: string,
  campaignNumber: number
): Promise<{ id: string; end_date: string | null }> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, end_date')
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

async function main(): Promise<void> {
  testCampaignMatching()

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

  const campaignA = await getCampaign(supabase, client.id, CAMPAIGN_NUMBER_A)
  const campaignB = await getCampaign(supabase, client.id, CAMPAIGN_NUMBER_B)
  const originalEndDateA = campaignA.end_date
  const originalEndDateB = campaignB.end_date

  console.log('\n=== Baseline : état initial (avant toute modification temporaire) ===')
  const baselineTotal = await countTotal(supabase, client.id)
  const baselineWithCampaign = await countWithCampaign(supabase, client.id)
  console.log(
    `Rendez-vous (client=${CLIENT_SLUG}) : ${baselineTotal} — dont campaign_id non nul : ${baselineWithCampaign}`
  )
  console.log(
    `Campagne n°${CAMPAIGN_NUMBER_A} end_date=${originalEndDateA ?? 'null'} ; ` +
      `campagne n°${CAMPAIGN_NUMBER_B} end_date=${originalEndDateB ?? 'null'}`
  )

  try {
    // --- Test 3 : fenêtre réelle temporaire, sans conflit ---------------
    console.log(
      `\n=== Test 3 : fenêtre réelle temporaire sur la campagne n°${CAMPAIGN_NUMBER_A} ` +
        '(2026-06-30 → 2026-07-17, Europe/Paris) ==='
    )
    await setCampaignEndDate(supabase, campaignA.id, '2026-07-17')
    const run3 = await syncAppointments(client.id, CAMPAIGN_NUMBER_A)
    printResult('Run 3 (fenêtre temporaire)', run3)

    const attachedToA = await countByCampaign(supabase, campaignA.id)
    if (attachedToA === 0 || attachedToA !== run3.campaignsAssigned) {
      throw new Error(
        `Anomalie test 3 : ${attachedToA} rendez-vous rattachés en base à la campagne n°${CAMPAIGN_NUMBER_A}, ` +
          `≠ campaignsAssigned de la synchro (${run3.campaignsAssigned}), ou nul.`
      )
    }
    console.log(
      `✅ ${attachedToA} rendez-vous réellement rattachés à la campagne n°${CAMPAIGN_NUMBER_A} en base.`
    )

    console.log(`\n--- Restauration après test 3 (end_date campagne n°${CAMPAIGN_NUMBER_A} -> null) ---`)
    await setCampaignEndDate(supabase, campaignA.id, null)
    const restore1 = await syncAppointments(client.id, CAMPAIGN_NUMBER_A)
    printResult('Restauration après test 3', restore1)

    const withCampaignAfterRestore1 = await countWithCampaign(supabase, client.id)
    if (withCampaignAfterRestore1 !== 0) {
      throw new Error(`Anomalie : ${withCampaignAfterRestore1} rendez-vous ont encore campaign_id non nul après restauration du test 3.`)
    }
    console.log('✅ Restauration confirmée : 0 rendez-vous avec campaign_id non nul.')

    // --- Test 4 : chevauchement réel temporaire --------------------------
    console.log(
      `\n=== Test 4 : chevauchement réel temporaire entre les campagnes n°${CAMPAIGN_NUMBER_A} et ` +
        `n°${CAMPAIGN_NUMBER_B} (zone de recouvrement 2026-07-18 → 2026-07-20, Europe/Paris) ===`
    )
    await setCampaignEndDate(supabase, campaignA.id, '2026-07-20')
    await setCampaignEndDate(supabase, campaignB.id, '2026-08-15')
    const run4 = await syncAppointments(client.id, CAMPAIGN_NUMBER_A)
    printResult('Run 4 (chevauchement temporaire)', run4)

    const overlapErrors = run4.errorDetails.filter((message) => message.includes('chevauchent'))
    if (overlapErrors.length === 0) {
      throw new Error('Anomalie test 4 : aucune erreur de chevauchement journalisée, alors que 4 rendez-vous réels sont attendus dans la zone de recouvrement.')
    }

    const overlapStartIso = '2026-07-17T22:00:00Z'
    const overlapEndIso = '2026-07-20T21:59:59Z'
    const overlapTotal = await countInRange(supabase, client.id, overlapStartIso, overlapEndIso)
    const overlapAttached = await countInRangeWithCampaign(supabase, client.id, overlapStartIso, overlapEndIso)
    if (overlapTotal === 0 || overlapAttached !== 0) {
      throw new Error(
        `Anomalie test 4 : ${overlapTotal} rendez-vous dans la zone de recouvrement, ${overlapAttached} attribués ` +
          '(attendu : > 0 rendez-vous, 0 attribué).'
      )
    }
    console.log(
      `✅ Chevauchement détecté et signalé (${overlapErrors.length} avertissement(s)) : ${overlapTotal} rendez-vous ` +
        'dans la zone de recouvrement, 0 attribué (aucune attribution arbitraire).'
    )

    const attachedToAAfterOverlap = await countByCampaign(supabase, campaignA.id)
    if (attachedToAAfterOverlap === 0) {
      throw new Error(
        `Anomalie test 4 : 0 rendez-vous rattachés à la campagne n°${CAMPAIGN_NUMBER_A} hors zone de recouvrement.`
      )
    }
    console.log(
      `✅ Hors recouvrement, ${attachedToAAfterOverlap} rendez-vous restent correctement rattachés à la ` +
        `campagne n°${CAMPAIGN_NUMBER_A}.`
    )

    console.log(
      `\n--- Restauration après test 4 (end_date campagnes n°${CAMPAIGN_NUMBER_A}/n°${CAMPAIGN_NUMBER_B} -> null) ---`
    )
    await setCampaignEndDate(supabase, campaignA.id, null)
    await setCampaignEndDate(supabase, campaignB.id, null)
    const restore2 = await syncAppointments(client.id, CAMPAIGN_NUMBER_A)
    printResult('Restauration après test 4', restore2)
  } finally {
    // Filet de sécurité : si une étape a levé une exception, on restaure quand
    // même end_date à sa valeur d'origine (constatée en base au tout début,
    // pas supposée) pour ne jamais laisser une fenêtre temporaire en place.
    await setCampaignEndDate(supabase, campaignA.id, originalEndDateA)
    await setCampaignEndDate(supabase, campaignB.id, originalEndDateB)
  }

  const finalTotal = await countTotal(supabase, client.id)
  const finalWithCampaign = await countWithCampaign(supabase, client.id)
  console.log('\n=== Vérification finale : base identique à l\'état initial ===')
  console.log(`Rendez-vous (client=${CLIENT_SLUG}) : ${finalTotal} — dont campaign_id non nul : ${finalWithCampaign}`)
  if (finalTotal !== baselineTotal || finalWithCampaign !== baselineWithCampaign) {
    throw new Error(
      `Anomalie : état final (total=${finalTotal}, avec campagne=${finalWithCampaign}) ≠ état initial ` +
        `(total=${baselineTotal}, avec campagne=${baselineWithCampaign}).`
    )
  }
  console.log('✅ Base finale identique à l\'état initial (campagnes restaurées, aucun campaign_id résiduel).')

  // --- Étape 5 : rejouer sans changement -> 0 update ----------------------
  console.log('\n=== Run final : sans changement, doit être un no-op ===')
  const runFinal = await syncAppointments(client.id, CAMPAIGN_NUMBER_A)
  printResult('Run final', runFinal)

  if (runFinal.created !== 0 || runFinal.updated !== 0) {
    throw new Error(
      `Anomalie : le run final a créé ${runFinal.created} et mis à jour ${runFinal.updated} ligne(s) au lieu de 0.`
    )
  }
  if (runFinal.skipped !== runFinal.read) {
    throw new Error(`Anomalie : le run final a ignoré ${runFinal.skipped} ligne(s) au lieu de ${runFinal.read} (lus).`)
  }

  console.log(
    '\n✅ Rattachement Calendly validé en fuseau Europe/Paris : attribution réelle démontrée puis restaurée, ' +
      'chevauchement réel non attribué et signalé, base finale identique à l\'état initial, 0 update au run final.'
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
