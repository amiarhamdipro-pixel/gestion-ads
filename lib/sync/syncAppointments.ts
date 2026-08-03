// Orchestration Calendly -> Supabase pour la table appointments. Lecture
// seule côté Calendly (voir lib/calendly/appointments.ts). Synchro réellement
// différentielle : chaque rendez-vous est comparé à la ligne existante
// (event_type_uri, start_time, status, acquisition_channel, campaign_id) et
// seuls les créations/changements réels sont envoyés à l'upsert (clé externe
// stable calendly_event_uri, unique en base, migration
// 20260801000000_appointments.sql) — un rendez-vous identique n'est pas
// réécrit. campaign_id est rattaché automatiquement par fenêtre de dates
// (campagnes du même client, start_date/end_date non nulles uniquement,
// lib/calculations.ts) : aucune ventilation Barbier/Coiffeur, aucune
// attribution arbitraire en cas de chevauchement (erreur explicite à la
// place).
//
// Lecture de l'acquisition_channel réellement incrémentale : la liste des
// événements (fetchScheduledEvents, statut/start_time/event_type_uri) est
// toujours relue en entier — pas chère, un seul type d'appel — mais /invitees
// (fetchAcquisitionChannels, coûteux, cause de la panne de synchro d'origine)
// n'est appelé QUE pour les rendez-vous nouveaux ou dont acquisition_channel
// est encore null/vide en base. Un rendez-vous déjà connu avec un canal
// renseigné réutilise directement la valeur stockée : jamais reperdue, jamais
// re-demandée à Calendly. Les champs structurels (status, start_time,
// event_type_uri) proviennent toujours de la lecture fraîche, jamais de la
// base — seul le canal est éligible à la réutilisation.
//
// Règle métier : le dashboard ne mesure que les performances Meta. Un
// rendez-vous n'est rattaché à une campagne (campaign_id) que si son
// acquisition_channel identifie Facebook ou Instagram, variante "... Ads"
// incluse (voir isMetaAcquisitionChannel ci-dessous) — les autres canaux (Google, Tiktok,
// MCB, etc., et les réponses vides) restent enregistrés tels quels dans
// appointments (aucune perte de donnée, aucune suppression), mais ne
// reçoivent jamais de campaign_id. Comme chaque page du dashboard et
// campaign_daily_stats filtrent déjà exclusivement sur campaign_id non nul
// (jamais sur acquisition_channel directement), cette seule règle suffit à
// exclure les canaux non-Meta de tous les calculs avals (KPI, coût réel/RDV,
// graphique, détail campagne, comparaison) sans toucher ces fichiers. Un
// rendez-vous non-Meta qui avait déjà un campaign_id avant ce correctif est
// automatiquement détaché (remis à null) au prochain passage : la
// comparaison isUnchanged ci-dessous traite ça comme un changement réel.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchAcquisitionChannels,
  fetchScheduledEvents,
  type CalendlyAppointmentRaw,
  type CalendlyScheduledAppointment,
} from '@/lib/calendly/appointments'
import { mapCalendlyEventToAppointmentInsert } from '@/lib/calendly/mapper'
import { campaignsMatchingAppointment, type CampaignWindow } from '@/lib/calculations'
import type { Appointment } from '@/types/database'

type ExistingAppointmentRow = Pick<
  Appointment,
  'calendly_event_uri' | 'event_type_uri' | 'start_time' | 'status' | 'acquisition_channel' | 'campaign_id'
>

type AppointmentWithCampaign = CalendlyAppointmentRaw & { campaign_id: string | null }

// Valeurs réellement observées en production (1147 rendez-vous, script de
// diagnostic ponctuel) : Facebook (245), Instagram (321), Facebook Ads (11),
// Instagram Ads (4), Google (290), Google Ads (8), Tiktok (71), Tiktok Ads
// (2), MCB (45), vide/null (150). acquisition_channel est un champ texte
// libre (lib/calendly/appointments.ts) : on normalise (trim + minuscule) et
// on retient tout canal commençant par "facebook" ou "instagram", pour
// couvrir aussi bien la réponse nue que sa variante "... Ads" — les deux
// désignent sans ambiguïté le même canal Meta.
function isMetaAcquisitionChannel(channel: string | null): boolean {
  if (!channel) return false
  const normalized = channel.trim().toLowerCase()
  return normalized.startsWith('facebook') || normalized.startsWith('instagram')
}

// start_time est comparé par instant (Date.getTime()), pas par égalité de
// chaîne : Calendly renvoie "...Z" alors que Postgres/PostgREST renvoie
// "...+00:00" pour le même instant — une comparaison de chaînes classerait
// systématiquement la ligne "modifiée" (constaté en conditions réelles).
function isUnchanged(existing: ExistingAppointmentRow, incoming: AppointmentWithCampaign): boolean {
  return (
    existing.event_type_uri === incoming.event_type_uri &&
    new Date(existing.start_time).getTime() === new Date(incoming.start_time).getTime() &&
    existing.status === incoming.status &&
    existing.acquisition_channel === incoming.acquisition_channel &&
    existing.campaign_id === incoming.campaign_id
  )
}

export type SyncAppointmentsResult = {
  read: number
  invitees: number
  created: number
  updated: number
  skipped: number
  errors: number
  errorDetails: string[]
  campaignsAssigned: number
  campaignsUnassigned: number
}

// .in() sérialise la liste dans la query string (requête GET) : au-delà de
// quelques dizaines d'URIs Calendly, la longueur dépasse la limite du proxy
// Supabase et échoue silencieusement (erreur au message vide) — observé en
// conditions réelles avec 1145 rendez-vous. D'où le découpage par lots, aussi
// bien pour la lecture de l'existant que pour l'upsert.
const CHUNK_SIZE = 50

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export async function syncAppointments(clientId: string): Promise<SyncAppointmentsResult> {
  const supabase = createAdminClient()
  const { events: rawEvents, errors: eventErrors } = await fetchScheduledEvents()

  // skipped compte deux cas : un doublon Calendly au sein du même lot
  // (défensif — ne devrait pas arriver, statuts actif/annulé disjoints) et,
  // plus bas, un rendez-vous déjà en base et strictement identique
  // (isUnchanged). Dans les deux cas, rien n'est envoyé à l'upsert.
  const seen = new Set<string>()
  const dedupedEvents: CalendlyScheduledAppointment[] = []
  let skipped = 0

  for (const event of rawEvents) {
    if (seen.has(event.calendly_event_uri)) {
      skipped += 1
      continue
    }
    seen.add(event.calendly_event_uri)
    dedupedEvents.push(event)
  }

  const errorDetails = [...eventErrors]

  if (dedupedEvents.length === 0) {
    return {
      read: rawEvents.length,
      invitees: 0,
      created: 0,
      updated: 0,
      skipped,
      errors: errorDetails.length,
      errorDetails,
      campaignsAssigned: 0,
      campaignsUnassigned: 0,
    }
  }

  const existingByUri = new Map<string, ExistingAppointmentRow>()
  for (const batch of chunk(
    dedupedEvents.map((e) => e.calendly_event_uri),
    CHUNK_SIZE
  )) {
    const { data: existingRows, error: existingError } = await supabase
      .from('appointments')
      .select('calendly_event_uri, event_type_uri, start_time, status, acquisition_channel, campaign_id')
      .in('calendly_event_uri', batch)

    if (existingError) {
      throw new Error(
        `Échec lecture des rendez-vous existants : ${existingError.message || JSON.stringify(existingError)}`
      )
    }
    for (const row of existingRows ?? []) {
      existingByUri.set(row.calendly_event_uri, row)
    }
  }

  // /invitees uniquement pour les rendez-vous nouveaux (absents de
  // existingByUri) ou dont le canal stocké est encore null/vide — jamais pour
  // un canal déjà connu (cause racine de la lenteur d'origine, voir en-tête).
  const needsChannelUris = dedupedEvents
    .filter((event) => !existingByUri.get(event.calendly_event_uri)?.acquisition_channel)
    .map((event) => event.calendly_event_uri)

  const { channels: freshChannels, errors: channelErrors, invited } = await fetchAcquisitionChannels(needsChannelUris)
  errorDetails.push(...channelErrors)

  const deduped: CalendlyAppointmentRaw[] = dedupedEvents.map((event) => {
    const existing = existingByUri.get(event.calendly_event_uri)
    const acquisitionChannel = freshChannels.has(event.calendly_event_uri)
      ? (freshChannels.get(event.calendly_event_uri) ?? null)
      : (existing?.acquisition_channel ?? null)
    return { ...event, acquisition_channel: acquisitionChannel }
  })

  // Campagnes du même client uniquement, avec start_date ET end_date
  // renseignées (les autres sont ignorées : fenêtre indéterminée).
  const { data: campaignRows, error: campaignsError } = await supabase
    .from('campaigns')
    .select('id, start_date, end_date, sync_locked')
    .eq('client_id', clientId)
    .not('start_date', 'is', null)
    .not('end_date', 'is', null)

  if (campaignsError) {
    throw new Error(`Échec lecture des campagnes : ${campaignsError.message || JSON.stringify(campaignsError)}`)
  }

  // Campagnes sync_locked=true (référence historique figée, voir
  // campaigns.sync_locked) : exclues de la fenêtre de rattachement pour les
  // NOUVEAUX rendez-vous (jamais rattachées désormais). Un rendez-vous déjà
  // rattaché à l'une d'elles avant son verrouillage n'est en revanche jamais
  // reconsidéré ci-dessous (sinon l'exclure de campaignWindows le ferait
  // détacher au prochain passage, faute de fenêtre correspondante — l'exact
  // inverse de "aucune synchro ne modifie ces valeurs").
  const lockedCampaignIds = new Set((campaignRows ?? []).filter((c) => c.sync_locked).map((c) => c.id))

  const campaignWindows: CampaignWindow[] = (campaignRows ?? [])
    .filter((c): c is { id: string; start_date: string; end_date: string; sync_locked: boolean } => c.start_date !== null && c.end_date !== null)
    .filter((c) => !c.sync_locked)
    .map((c) => ({ id: c.id, startDate: c.start_date, endDate: c.end_date }))

  let created = 0
  let updated = 0
  let campaignsAssigned = 0
  let campaignsUnassigned = 0
  const toUpsert: AppointmentWithCampaign[] = []

  for (const appointment of deduped) {
    const existing = existingByUri.get(appointment.calendly_event_uri)

    let campaignId: string | null
    if (existing?.campaign_id && lockedCampaignIds.has(existing.campaign_id)) {
      // Déjà rattaché à une campagne verrouillée avant son verrouillage :
      // jamais reconsidéré (voir commentaire sur campaignWindows ci-dessus).
      campaignId = existing.campaign_id
    } else {
      const matches = isMetaAcquisitionChannel(appointment.acquisition_channel)
        ? campaignsMatchingAppointment(campaignWindows, appointment.start_time)
        : []

      if (matches.length > 1) {
        // Chevauchement : aucune attribution arbitraire. On préserve la valeur
        // déjà en base (ou null pour une création) et on journalise l'erreur.
        campaignId = existing?.campaign_id ?? null
        errorDetails.push(
          `Rendez-vous ${appointment.calendly_event_uri} : ${matches.length} campagnes se chevauchent ` +
            `(${matches.join(', ')}) — aucune attribution automatique.`
        )
      } else {
        campaignId = matches[0] ?? null
      }
    }

    if (campaignId) {
      campaignsAssigned += 1
    } else {
      campaignsUnassigned += 1
    }

    const incoming: AppointmentWithCampaign = { ...appointment, campaign_id: campaignId }

    if (!existing) {
      created += 1
      toUpsert.push(incoming)
    } else if (isUnchanged(existing, incoming)) {
      skipped += 1
    } else {
      updated += 1
      toUpsert.push(incoming)
    }
  }

  for (const batch of chunk(toUpsert, CHUNK_SIZE)) {
    const payload = batch.map((appointment) =>
      mapCalendlyEventToAppointmentInsert(clientId, appointment, appointment.campaign_id)
    )
    const { error: upsertError } = await supabase.from('appointments').upsert(payload, { onConflict: 'calendly_event_uri' })

    if (upsertError) {
      throw new Error(`Échec upsert appointments : ${upsertError.message || JSON.stringify(upsertError)}`)
    }
  }

  return {
    read: rawEvents.length,
    invitees: invited,
    created,
    updated,
    skipped,
    errors: errorDetails.length,
    errorDetails,
    campaignsAssigned,
    campaignsUnassigned,
  }
}
