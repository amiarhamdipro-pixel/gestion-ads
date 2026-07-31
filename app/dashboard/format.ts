// Palette et formatage partagés entre page.tsx et les composants de la vue
// d'ensemble — reprend dashboard-maquette_1.html sans copier sa feuille de style.

export const ink = '#16172E'
export const muted = '#71748C'
export const faint = '#9A9DB2'
export const line = '#E4E7F0'
export const surface = '#FFFFFF'
export const surfaceAlt = '#F6F7FB'
export const accent = '#4A38D1'
export const spendColor = '#E28234'
export const radius = 16

export function formatEur(n: number): string {
  return Math.round(n).toLocaleString('fr-FR')
}

export function formatCost(n: number | null): string {
  return n === null ? '—' : n.toFixed(2).replace('.', ',') + ' €'
}

export function formatPeriod(startDate: string | null, endDate: string | null): string {
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  if (startDate && endDate) return `${formatter.format(new Date(startDate))} – ${formatter.format(new Date(endDate))}`
  if (startDate) return `À partir du ${formatter.format(new Date(startDate))}`
  return 'Période non disponible'
}
