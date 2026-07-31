// Script local, jetable : exécute le pipeline lib/sync/* sur la campagne
// configurée dans .env (META_CAMPAIGN_ID / CAMPAIGN_NUMBER) et vérifie les
// données récupérées. Lecture Meta uniquement (GET) — aucune écriture
// Supabase, ni fichier. Lance avec `npm run test:meta-sync`.

import { readFileSync } from 'node:fs'
import { fetchAdInsights, fetchAdSetAds, fetchAdSetInsights, fetchCampaignAdSets } from '../lib/sync/meta'
import { classifyAudienceType, filterAdSetsByCampaignNumber, groupByCampaignNumber } from '../lib/sync/groupByCampaign'
import { mapAdSetToAudienceInsert, mapAdToVideoInsert } from '../lib/sync/mapper'

const REQUIRED_VARS = ['META_ACCESS_TOKEN', 'META_API_VERSION', 'META_CAMPAIGN_ID', 'CAMPAIGN_NUMBER'] as const
const TARGET_CONVERSION_NAME = 'Lead - Confirmation de RDV by Amerys Agency'

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

type MetaCustomConversion = { id: string; name: string }

// Diagnostic autonome (ne dépend pas de lib/sync/meta.ts) : liste les conversions
// personnalisées du compte pour identifier, par NOM, l'action_type exact de
// « Lead - Confirmation de RDV by Amerys Agency ». Lecture seule (GET).
async function fetchCustomConversions(adAccountId: string): Promise<MetaCustomConversion[]> {
  const accessToken = process.env.META_ACCESS_TOKEN as string
  const apiVersion = process.env.META_API_VERSION as string

  const url = new URL(`https://graph.facebook.com/${apiVersion}/${adAccountId}/customconversions`)
  url.searchParams.set('fields', 'id,name')
  url.searchParams.set('access_token', accessToken)

  const response = await fetch(url)
  const json: unknown = await response.json()

  if (typeof json === 'object' && json !== null && 'error' in json) {
    const err = (json as { error: { message: string; code: number } }).error
    throw new Error(`Meta API — ${err.message} (code ${err.code})`)
  }

  return (json as { data?: MetaCustomConversion[] }).data ?? []
}

function parseCampaignNumber(): number {
  const raw = process.env.CAMPAIGN_NUMBER as string
  const value = Number(raw)
  if (!Number.isInteger(value)) {
    throw new Error(`CAMPAIGN_NUMBER invalide : "${raw}" n'est pas un entier.`)
  }
  return value
}

const PLACEHOLDER_CAMPAIGN_ID = 'local-test-run'
const PLACEHOLDER_AUDIENCE_ID = 'local-test-audience'

function assertExactlyTwoAdSets(
  adSets: Awaited<ReturnType<typeof fetchCampaignAdSets>>,
  campaignNumber: number
): ReturnType<typeof filterAdSetsByCampaignNumber> {
  const matched = filterAdSetsByCampaignNumber(adSets, campaignNumber)
  if (matched.length !== 2) {
    const found = matched.length > 0 ? ` Trouvés : ${matched.map((a) => a.name).join(' | ')}` : ''
    throw new Error(
      `Regroupement invalide : ${matched.length} ad set(s) trouvé(s) pour le préfixe "${campaignNumber}" (2 attendus).${found}`
    )
  }
  return matched
}

async function main(): Promise<void> {
  loadEnvFile('.env')
  loadEnvFile('.env.local')
  assertRequiredEnv()

  if (!process.env.LEAD_ACTION_TYPE) {
    console.log('\n=== Diagnostic : conversions personnalisées Meta (LEAD_ACTION_TYPE non défini) ===')
    const adAccountId = process.env.META_AD_ACCOUNT_ID
    if (!adAccountId) {
      throw new Error('META_AD_ACCOUNT_ID manquant dans .env : nécessaire pour lister les conversions personnalisées.')
    }

    const customConversions = await fetchCustomConversions(adAccountId)
    console.log(`Conversions personnalisées trouvées : ${customConversions.length}`)
    customConversions.forEach((c) => console.log(`  • id ${c.id} — "${c.name}"`))

    const matches = customConversions.filter(
      (c) => c.name.trim().toLowerCase() === TARGET_CONVERSION_NAME.toLowerCase()
    )

    if (matches.length === 1) {
      const actionType = `offsite_conversion.custom.${matches[0].id}`
      console.log(`\n✅ Confirmé par nom exact : "${matches[0].name}" → action_type = ${actionType}`)
      throw new Error(
        `LEAD_ACTION_TYPE manquant dans .env. Valeur confirmée à ajouter : LEAD_ACTION_TYPE=${actionType}, puis relancer.`
      )
    }

    if (matches.length === 0) {
      throw new Error(
        `LEAD_ACTION_TYPE manquant dans .env, et aucune conversion personnalisée nommée exactement ` +
          `"${TARGET_CONVERSION_NAME}" trouvée. Ne pas deviner : vérifier le nom exact dans le Gestionnaire ` +
          "d'événements Meta."
      )
    }

    throw new Error(
      `LEAD_ACTION_TYPE manquant dans .env, et ${matches.length} conversions personnalisées portent ce nom : ` +
        `ambigu, à résoudre manuellement (ids : ${matches.map((m) => m.id).join(', ')}).`
    )
  }

  const leadActionType = process.env.LEAD_ACTION_TYPE as string
  const metaCampaignId = process.env.META_CAMPAIGN_ID as string
  const campaignNumber = parseCampaignNumber()

  console.log(`\n=== Test pipeline Meta — campagne n°${campaignNumber} ===`)
  console.log(`Campagne maître Meta : ${metaCampaignId}`)

  const adSets = await fetchCampaignAdSets(metaCampaignId)
  console.log(`Ad sets trouvés sur la campagne maître : ${adSets.length}`)

  const matched = assertExactlyTwoAdSets(adSets, campaignNumber)

  const audienceTypes = matched.map((adSet) => classifyAudienceType(adSet.name))
  if (audienceTypes[0] === audienceTypes[1]) {
    throw new Error(
      `Audiences dupliquées : les deux ad sets sont classés "${audienceTypes[0]}". ` +
        `Vérifie le nommage : ${matched.map((a) => a.name).join(' | ')}`
    )
  }

  const group = groupByCampaignNumber(adSets, campaignNumber)
  if (!group.barbier || !group.coiffeur) {
    throw new Error('Regroupement incomplet : audience barbier ou coiffeur introuvable après classification.')
  }

  console.log('\nAudiences retenues :')
  console.log(`  Barbier  : ${group.barbier.name} [${group.barbier.status}] — id Meta ${group.barbier.id}`)
  console.log(`  Coiffeur : ${group.coiffeur.name} [${group.coiffeur.status}] — id Meta ${group.coiffeur.id}`)

  let hasUsableVideoStats = false

  for (const [label, adSet] of [
    ['Barbier', group.barbier],
    ['Coiffeur', group.coiffeur],
  ] as const) {
    const insights = await fetchAdSetInsights(adSet.id)
    const audience = mapAdSetToAudienceInsert(PLACEHOLDER_CAMPAIGN_ID, adSet, insights, leadActionType)

    console.log(`\n--- ${label} (${adSet.name}) ---`)
    console.log(`  Période      : ${adSet.start_time ?? '—'} → ${adSet.end_time ?? '—'}`)
    console.log(`  Dépensé Meta : ${audience.meta_spend.toFixed(2)} €`)
    console.log(`  Leads pixel ("${leadActionType}") : ${audience.meta_pixel_leads}`)

    const ads = await fetchAdSetAds(adSet.id)
    if (ads.length === 0) {
      throw new Error(`Aucune pub trouvée pour l'ad set "${adSet.name}".`)
    }
    console.log(`  Pubs trouvées : ${ads.length}`)

    for (const ad of ads) {
      const adInsights = await fetchAdInsights(ad.id)
      const video = mapAdToVideoInsert(PLACEHOLDER_AUDIENCE_ID, ad, adInsights)

      if (video.impressions > 0 || video.video_plays > 0) {
        hasUsableVideoStats = true
      }

      const hookPlay = video.impressions > 0 ? ((video.video_plays / video.impressions) * 100).toFixed(1) : '—'
      const hookThru = video.impressions > 0 ? ((video.thruplays / video.impressions) * 100).toFixed(1) : '—'
      const retention = video.video_p25 > 0 ? ((video.video_p100 / video.video_p25) * 100).toFixed(1) : '—'

      console.log(`    PUB ${ad.name} — id Meta ${ad.id}`)
      console.log(
        `      Impressions ${video.impressions} · Plays ${video.video_plays} · ThruPlays ${video.thruplays} · ` +
          `Accroche ${hookPlay}% (play) / ${hookThru}% (thruplay) · Rétention ${retention}%`
      )
    }
  }

  if (!hasUsableVideoStats) {
    throw new Error('Aucune statistique vidéo exploitable trouvée sur les pubs des 2 audiences.')
  }

  console.log('\n✅ Pipeline Meta validé : 2 audiences (barbier + coiffeur), pubs et stats vidéo récupérées.')
  console.log('Aucune écriture effectuée (ni Supabase, ni fichier).')

  console.log('\n=== Test cas négatif : numéro de campagne inexistant ===')
  const bogusNumber = 999999
  try {
    assertExactlyTwoAdSets(adSets, bogusNumber)
    throw new Error(`Anomalie : le numéro "${bogusNumber}" aurait dû être rejeté et ne l'a pas été.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`✅ Erreur explicite obtenue comme attendu : ${message}`)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
