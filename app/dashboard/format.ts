// Palette et formatage partagés dans tout /dashboard. Palette officielle
// reprise telle quelle des swatches en bas de MAQUETTE-UI.png (source de
// vérité visuelle du projet) — jamais de teinte inventée en dehors de ces
// 7 couleurs ; les fonds "chip" clairs dérivés du vert/ambre/rouge passent
// par softBg() (alpha réduit sur la couleur officielle), jamais une nouvelle
// teinte nommée.

export const ink = '#16172E'
export const muted = '#71748C'
export const faint = '#9A9DB2'
export const line = '#E4E7F0'
export const surface = '#FFFFFF'
export const surfaceAlt = '#F6F7FB'
export const radius = 16

// Swatches officiels (MAQUETTE-UI.png, bloc "PALETTE")
export const indigo = '#4F46E5'
export const violet = '#7C3AED'
export const lavender = '#EDE9FE'
export const green = '#10B981'
export const amber = '#F59E0B'
export const red = '#EF4444'
export const gray = '#6B7280'

// Alias conservés pour les composants existants (mêmes rôles qu'avant,
// couleurs alignées sur la maquette).
export const accent = indigo
export const spendColor = indigo

// Fond sombre du header et de l'état actif de la sidebar : non fourni comme
// swatch isolé dans la maquette (qui ne montre que la palette d'accents),
// teinte la plus sombre visible sur le bandeau du header — dérivé de la
// même famille indigo pour rester cohérent avec les swatches officiels.
export const headerBg = '#1E1B4B'

export const onDark = '#FFFFFF'
export const onDarkMuted = 'rgba(255, 255, 255, 0.62)'
export const onDarkLine = 'rgba(255, 255, 255, 0.12)'
// Rouge lisible sur fond sombre (headerBg) — `red` (#EF4444) n'offre pas un
// contraste suffisant (~4,25:1) pour du texte 11-12px sur headerBg. Valeur
// déjà utilisée telle quelle dans SyncMetaButton/SyncCalendlyButton, promue
// ici en token nommé pour rester cohérente si réutilisée ailleurs.
export const redOnDark = '#FF9B9B'

export const sidebarWidth = 232

// rgba() à alpha réduit sur une couleur officielle (jamais une teinte inventée)
// pour les fonds "chip"/pill clairs (icônes KPI, badges de statut).
export function softBg(hex: string, alpha = 0.12): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function formatEur(n: number): string {
  return Math.round(n).toLocaleString('fr-FR')
}

export function formatCost(n: number | null): string {
  return n === null ? '—' : n.toFixed(2).replace('.', ',') + ' €'
}

export function formatPct(n: number | null, digits = 1): string {
  return n === null ? '—' : `${(n * 100).toFixed(digits).replace('.', ',')} %`
}

export function formatPeriod(startDate: string | null, endDate: string | null): string {
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  if (startDate && endDate) return `${formatter.format(new Date(startDate))} – ${formatter.format(new Date(endDate))}`
  if (startDate) return `À partir du ${formatter.format(new Date(startDate))}`
  return 'Période non disponible'
}

export function formatDateTime(iso: string | null, fallback = 'Aucune synchronisation'): string {
  if (!iso) return fallback
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return formatter.format(new Date(iso))
}
