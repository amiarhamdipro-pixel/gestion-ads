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
