// Reconstruit la query string du filtre de période à partir des searchParams
// déjà reçus par une page, pour que les liens internes (ex. vers le détail
// d'une campagne) conservent le même filtre en navigant. Pure plomberie
// d'URL — aucune logique métier (voir lib/calculations.ts pour le calcul de
// la période elle-même, DashboardDateFilter.tsx pour la lecture/écriture
// côté client).
export function buildDateRangeQueryString(searchParams: { period?: string; from?: string; to?: string }): string {
  const params = new URLSearchParams()
  if (searchParams.period) params.set('period', searchParams.period)
  if (searchParams.from) params.set('from', searchParams.from)
  if (searchParams.to) params.set('to', searchParams.to)
  const query = params.toString()
  return query ? `?${query}` : ''
}
