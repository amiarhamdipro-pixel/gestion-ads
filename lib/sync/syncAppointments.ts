// Orchestration Calendly -> Supabase pour la table appointments. Lecture
// seule côté Calendly (voir lib/calendly/appointments.ts). Synchro réellement
// différentielle : chaque rendez-vous est comparé à la ligne existante
// (event_type_uri, start_time, status, acquisition_channel,
// booking_created_at, campaign_id) et seuls les créations/changements réels
// sont envoyés à l'upsert (clé externe stable calendly_event_uri, unique en
// base, migration 20260801000000_appointments.sql) — un rendez-vous
// identique n'est pas réécrit.
//
// Règle de rattachement de campagne : campaign_id est déterminé par la date
// de CRÉATION de la réservation Calendly (booking_created_at, invitee.
// created_at — voir lib/calendly/appointments.ts), pas par la date prévue du
// rendez-vous (start_time). Une conversion appartient à la campagne active au
// moment où la réservation est créée : un rendez-vous prévu après la fin
// d'une campagne peut donc lui être rattaché si sa réservation a été prise
// pendant la fenêtre de cette campagne (cas réel constaté : campagne 20,
// 3 réservations Instagram créées entre le 29/07 et le 31/07 pour des
// créneaux planifiés après le 01/08). AVANT : campaign.start_date <=
// appointment.start_time <= campaign.end_date. APRÈS : campaign.start_date
// <= appointment.booking_created_at <= campaign.end_date. start_time reste
// stockée et affichée pour l'information opérationnelle du rendez-vous, mais
// n'est plus jamais utilisée pour ce rattachement (lib/calculations.ts :
// aucune ventilation Barbier/Coiffeur, aucune attribution arbitraire en cas
// de chevauchement — erreur explicite à la place). Si booking_created_at est
// encore null (rendez-vous pas encore enrichi, voir plus bas), aucun
// rattachement n'est tenté : jamais de repli sur start_time.
//
// Lecture de l'acquisition_channel ET de booking_created_at réellement
// incrémentale : la liste des événements (fetchScheduledEvents, statut/
// start_time/event_type_uri) est toujours relue en entier — pas chère, un
// seul type d'appel — mais /invitees (fetchInviteeDetails, coûteux, cause de
// la panne de synchro d'origine) n'est appelé QUE pour les rendez-vous
// nouveaux ou dont acquisition_channel OU booking_created_at est encore
// null/vide en base. Un rendez-vous déjà connu avec ces deux valeurs déjà
// renseignées réutilise directement les valeurs stockées : jamais reperdues,
// jamais re-demandées à Calendly. Les champs structurels (status, start_time,
// event_type_uri) proviennent toujours de la lecture fraîche, jamais de la
// base — seuls le canal et booking_created_at sont éligibles à la
// réutilisation. Effet de bord attendu et ponctuel : booking_created_at étant
// un champ nouveau, la première synchro qui suit son introduction ré-appelle
// /invitees pour tous les rendez-vous déjà connus (coût comparable à la
// synchro à froid d'origine) ; les synchros suivantes redeviennent
// incrémentales normalement.
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
  fetchInviteeDetails,
  fetchScheduledEvents,
  type CalendlyAppointmentRaw,
  type CalendlyScheduledAppointment,
} from '@/lib/calendly/appointments'
import { mapCalendlyEventToAppointmentInsert } from '@/lib/calendly/mapper'
import { campaignsMatchingAppointment, type CampaignWindow } from '@/lib/calculations'
import type { Appointment } from '@/types/database'

type ExistingAppointmentRow = Pick<
  Appointment,
  'calendly_event_uri' | 'event_type_uri' | 'start_time' | 'status' | 'acquisition_channel' | 'booking_created_at' | 'campaign_id'
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

// start_time/booking_created_at sont comparés par instant (Date.getTime()),
// pas par égalité de chaîne : Calendly renvoie "...Z" alors que Postgres/
// PostgREST renvoie "...+00:00" pour le même instant — une comparaison de
// chaînes classerait systématiquement la ligne "modifiée" (constaté en
// conditions réelles).
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return new Date(a).getTime() === new Date(b).getTime()
}

function isUnchanged(existing: ExistingAppointmentRow, incoming: AppointmentWithCampaign): boolean {
  return (
    existing.event_type_uri === incoming.event_type_uri &&
    sameInstant(existing.start_time, incoming.start_time) &&
    existing.status === incoming.status &&
    existing.acquisition_channel === incoming.acquisition_channel &&
    sameInstant(existing.booking_created_at, incoming.booking_created_at) &&
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

  // skipped compte trois cas : un doublon Calendly au sein du même lot
  // (défensif — ne devrait pas arriver, statuts actif/annulé disjoints), un
  // rendez-vous déjà rattaché à une campagne verrouillée (gelé
  // intégralement, voir plus bas) et un rendez-vous déjà en base et
  // strictement identique (isUnchanged). Dans les trois cas, rien n'est
  // envoyé à l'upsert.
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
      .select('calendly_event_uri, event_type_uri, start_time, status, acquisition_channel, booking_created_at, campaign_id')
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
  // existingByUri) ou dont le canal OU booking_created_at stocké est encore
  // null/vide — jamais pour un rendez-vous dont les deux valeurs sont déjà
  // connues (cause racine de la lenteur d'origine, voir en-tête).
  const needsInviteeDetailsUris = dedupedEvents
    .filter((event) => {
      const existing = existingByUri.get(event.calendly_event_uri)
      return !existing?.acquisition_channel || !existing?.booking_created_at
    })
    .map((event) => event.calendly_event_uri)

  const { details: freshDetails, errors: detailErrors, invited } = await fetchInviteeDetails(needsInviteeDetailsUris)
  errorDetails.push(...detailErrors)

  const deduped: CalendlyAppointmentRaw[] = dedupedEvents.map((event) => {
    const existing = existingByUri.get(event.calendly_event_uri)
    const fresh = freshDetails.get(event.calendly_event_uri)
    const acquisitionChannel = fresh ? (fresh.acquisitionChannel ?? null) : (existing?.acquisition_channel ?? null)
    const bookingCreatedAt = fresh ? (fresh.bookingCreatedAt ?? null) : (existing?.booking_created_at ?? null)
    return { ...event, acquisition_channel: acquisitionChannel, booking_created_at: bookingCreatedAt }
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

  // Campagnes sync_locked=true (verrouillage définitif — publication admin
  // OU référence historique figée, voir campaigns.sync_locked et
  // BRIEF-CLAUDE-CODE.md, règle "plus jamais resynchronisée") : exclues de la
  // fenêtre de rattachement pour les NOUVEAUX rendez-vous ci-dessous.
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

    // Déjà rattaché à une campagne verrouillée (published=true,
    // sync_locked=true) : gelé INTÉGRALEMENT, ligne entière jamais réécrite
    // par une synchro future — même si son statut Calendly a changé depuis
    // (ex. annulation). "Plus jamais resynchronisée" s'applique à la ligne
    // entière, pas seulement à campaign_id (voir BRIEF-CLAUDE-CODE.md,
    // nouvelle règle métier) : sans ce garde, un rendez-vous annulé après
    // verrouillage ferait quand même passer status='canceled' à l'upsert,
    // et campaign_daily_stats.calendly_appointments (via
    // syncCalendlyDailyStats, qui ne compte que status='active') changerait
    // silencieusement pour une campagne pourtant "figée".
    if (existing?.campaign_id && lockedCampaignIds.has(existing.campaign_id)) {
      skipped += 1
      continue
    }

    let campaignId: string | null
    {
      // Rattachement par date de CRÉATION de la réservation
      // (booking_created_at), jamais par start_time (voir en-tête). Sans
      // booking_created_at (rendez-vous pas encore enrichi), aucun
      // rattachement n'est tenté — jamais de repli sur start_time.
      const matches =
        isMetaAcquisitionChannel(appointment.acquisition_channel) && appointment.booking_created_at
          ? campaignsMatchingAppointment(campaignWindows, appointment.booking_created_at)
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
