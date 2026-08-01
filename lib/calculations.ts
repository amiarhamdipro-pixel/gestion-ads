// Fonctions de calcul métier pures. Aucune ne touche à la base : elles prennent
// des valeurs déjà chargées et retournent `null` quand un ratio n'est pas calculable
// (division par zéro, dates absentes ou invalides).

export function realAppointments(calendlyAppointments: number, manualAdjustment: number): number {
  return calendlyAppointments + manualAdjustment
}

export function realCostPerAppointment(metaSpend: number, realAppointmentsCount: number): number | null {
  if (realAppointmentsCount <= 0) return null
  return metaSpend / realAppointmentsCount
}

export function trackingGap(realAppointmentsCount: number, metaPixelLeads: number): number {
  return realAppointmentsCount - metaPixelLeads
}

// Coût pixel, PAS le coût réel (dépensé ÷ RDV Calendly, cf. realCostPerAppointment) :
// utile tant que Calendly n'est pas branché, à ne jamais présenter comme le coût/lead réel.
export function costPerMetaPixelLead(metaSpend: number, metaPixelLeads: number): number | null {
  if (metaPixelLeads <= 0) return null
  return metaSpend / metaPixelLeads
}

export function campaignDurationDays(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null

  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null

  const msPerDay = 24 * 60 * 60 * 1000
  const durationDays = Math.round((end.getTime() - start.getTime()) / msPerDay) + 1
  return durationDays > 0 ? durationDays : null
}

export function appointmentsPerDay(realAppointmentsCount: number, durationDays: number | null): number | null {
  if (!durationDays || durationDays <= 0) return null
  return realAppointmentsCount / durationDays
}

export function spendPerDay(metaSpend: number, durationDays: number | null): number | null {
  if (!durationDays || durationDays <= 0) return null
  return metaSpend / durationDays
}

export function metaPixelLeadsPerDay(metaPixelLeads: number, durationDays: number | null): number | null {
  if (!durationDays || durationDays <= 0) return null
  return metaPixelLeads / durationDays
}

export function hookRatePlay(videoPlays: number, impressions: number): number | null {
  if (impressions <= 0) return null
  return videoPlays / impressions
}

export function hookRateThruplay(thruplays: number, impressions: number): number | null {
  if (impressions <= 0) return null
  return thruplays / impressions
}

export function retentionRate(videoP100: number, videoP25: number): number | null {
  if (videoP25 <= 0) return null
  return videoP100 / videoP25
}

// Fenêtre de campagne utilisée pour rattacher automatiquement un rendez-vous
// (lib/sync/syncAppointments.ts). startDate/endDate sont des dates (pas des
// timestamps) : la fenêtre couvre startDate 00:00:00 à endDate 23:59:59, en
// heure locale Europe/Paris (fuseau métier — le client et ses rendez-vous
// Calendly sont en France), pas en UTC. Une conversion naïve en UTC décale
// systématiquement les bornes de 1h ou 2h selon la saison (CET/CEST), ce qui
// peut faire manquer ou déborder un rendez-vous proche de minuit.
export type CampaignWindow = {
  id: string
  startDate: string
  endDate: string
}

const BUSINESS_TIMEZONE = 'Europe/Paris'

// Décalage UTC (en minutes) d'Europe/Paris à l'instant utcDate : +60 en
// heure d'hiver (CET), +120 en heure d'été (CEST). Calculé via Intl
// (disponible nativement, aucune dépendance ajoutée) plutôt que codé en dur,
// pour rester correct de part et d'autre des changements d'heure.
function parisOffsetMinutes(utcDate: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(utcDate)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const asIfUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return (asIfUtcMs - utcDate.getTime()) / 60000
}

// Convertit une date calendaire (YYYY-MM-DD) + heure locale Europe/Paris en
// instant UTC (ms epoch). Deux passes : une estimation naïve (heure locale
// traitée comme si elle était déjà UTC) donne un instant assez proche pour
// déterminer le bon décalage saisonnier, qui sert ensuite à corriger
// l'estimation — y compris le jour même d'un changement d'heure, car 00:00:00
// et 23:59:59 tombent toujours hors de l'heure ambiguë/inexistante du
// changement (qui se produit à 2h/3h locales en Europe/Paris).
function parisDateToUtcMs(dateStr: string, hour: number, minute: number, second: number): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsetMinutes = parisOffsetMinutes(new Date(naiveUtcMs))
  return naiveUtcMs - offsetMinutes * 60000
}

// Retourne les ids des campagnes dont la fenêtre contient startTime. 0 id =
// aucun rattachement ; 1 id = rattachement possible ; 2+ ids = chevauchement,
// à traiter comme une erreur explicite par l'appelant (aucune attribution
// arbitraire ici).
export function campaignsMatchingAppointment(campaigns: CampaignWindow[], startTime: string): string[] {
  const startTimeMs = new Date(startTime).getTime()
  return campaigns
    .filter((campaign) => {
      const windowStartMs = parisDateToUtcMs(campaign.startDate, 0, 0, 0)
      const windowEndMs = parisDateToUtcMs(campaign.endDate, 23, 59, 59)
      return startTimeMs >= windowStartMs && startTimeMs <= windowEndMs
    })
    .map((campaign) => campaign.id)
}
