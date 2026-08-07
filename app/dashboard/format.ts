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

// Orange dédié au graphique Vue d'ensemble (courbe "Dépensé", voir
// OverviewChart.tsx) : le bleu/indigo dominait trop la lecture du graphe
// combiné RDV+dépensé (deux séries proches en teinte, difficiles à
// distinguer au premier coup d'œil) — remplacé par cet orange, réservé au
// graphique principal, jamais utilisé comme accent/navigation (qui reste
// indigo, "Bleu Amerys"). Choisi (pas la teinte `amber` existante, trop
// claire : ~2,1:1 sur blanc, illisible) puis vérifié via le validateur de la
// skill dataviz : #7C3AED (violet, barres RDV) / #C2410C (orange, ici) —
// séparation CVD (daltonisme) ΔE 32.7 (protan) et contraste ≥3:1 sur
// surface blanche, tout au vert.
export const chartOrange = '#C2410C'

// Facebook/Instagram (page Détail campagne) : même principe d'exception
// justifiée que chartOrange ci-dessus, jamais utilisées comme accent
// général. Avant cette paire dédiée, Facebook/Instagram héritaient
// d'indigo/violet (rotation CHANNEL_COLORS générique) — deux teintes
// bleu/violet trop proches pour être distinguées au premier coup d'œil.
// Bleu Facebook officiel (#1877F2) et magenta Instagram (#E4405F, teinte
// plate représentative de la marque, qui utilise en réalité un dégradé) :
// écart de teinte volontairement large (bleu pur vs rouge-magenta), donc
// identifiables même en daltonisme rouge-vert (le bleu reste hors de l'axe
// de confusion protan/deutan). Contraste vérifié à la main (formule WCAG)
// sur fond blanc : facebookBlue ≈ 4,2:1, instagramMagenta ≈ 4,0:1 —
// au-dessus du minimum non-textuel (3:1, WCAG 1.4.11). Jamais utilisées
// comme couleur de texte directe : toujours du texte `ink` sur un fond
// softBg() pâle, ou un simple repère graphique (point de légende, anneau de
// donut) — le contraste textuel (AA, 4.5:1) reste garanti par ce même
// principe déjà appliqué partout ailleurs sur le dashboard.
export const facebookBlue = '#1877F2'
export const instagramMagenta = '#E4405F'

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
  // timeZone fixe : sans elle, Intl utilise le fuseau du runtime, qui diffère
  // entre le rendu serveur (UTC sur l'hébergeur) et le navigateur du client
  // (Europe/Paris) — l'heure affichée changeait selon qui la rendait, ce qui
  // déclenchait une erreur d'hydratation React (#418) sur le header et
  // interrompait l'accroche des gestionnaires de clic du menu mobile juste
  // après hydratation.
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  })
  return formatter.format(new Date(iso))
}

// --- État partagé du tiroir mobile (Header.tsx = déclencheur, Sidebar.tsx =
// contenu/fermeture) ---
// Remplace l'ancien mécanisme "case à cocher cachée + sélecteur CSS `~`" :
// en production, pour un compte admin, le header s'empile sur plus de lignes
// que l'espacement fixe supposé par la sidebar (padding-top codé en dur), si
// bien que le header (z-index supérieur) recouvrait et interceptait les clics
// destinés au bouton fermer/aux liens de la sidebar — le menu semblait ne
// jamais se refermer. useSyncExternalStore donne une seule source de vérité
// simple, sans dépendre du DOM (getElementById/.click()) ni d'une hauteur de
// header supposée.
type MobileMenuListener = () => void
let mobileMenuOpen = false
const mobileMenuListeners = new Set<MobileMenuListener>()

export function getMobileMenuOpen(): boolean {
  return mobileMenuOpen
}

export function setMobileMenuOpen(open: boolean): void {
  if (mobileMenuOpen === open) return
  mobileMenuOpen = open
  mobileMenuListeners.forEach((listener) => listener())
}

export function subscribeMobileMenu(listener: MobileMenuListener): () => void {
  mobileMenuListeners.add(listener)
  return () => mobileMenuListeners.delete(listener)
}
