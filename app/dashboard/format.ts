// Palette et formatage partagés dans tout /dashboard (et écrans d'auth).
// Identité visuelle : charte officielle Amerys Agency
// (Charte_graphique_Amerys_ADS.pdf). Chaque couleur exportée ici est une
// RÉFÉRENCE à une variable CSS définie dans app/globals.css, pour les deux
// thèmes (nuit par défaut, clair en option — data-theme sur <html>) : les
// composants restent inchangés et suivent le thème actif. Jamais de valeur
// hexadécimale en dur dans un composant : passer par ces exports.
//
// Noms d'export conservés (ink, muted, indigo...) pour limiter le diff ; leur
// rôle est documenté ci-dessous.

// Textes et surfaces
export const ink = 'var(--amerys-text)'
export const textSoft = 'var(--amerys-text-soft)'
export const muted = 'var(--amerys-text-muted)'
export const faint = 'var(--amerys-text-muted)'
export const line = 'var(--amerys-card-border)'
export const borderStrong = 'var(--ads-border-strong)'
export const pageBg = 'var(--amerys-bg)'
export const section = 'var(--amerys-section)'
export const surface = 'var(--amerys-surface)'
export const surfaceElevated = 'var(--amerys-surface-elevated)'
// Fond secondaire discret À L'INTÉRIEUR d'une carte (en-têtes de tableau,
// encarts, pistes de donut).
export const surfaceAlt = 'var(--ads-surface-alt)'
// Rayons de la charte : cartes 18 px, boutons 9 px.
export const radius = 18
export const radiusButton = 9
export const shadow = 'var(--ads-shadow)'
export const overlay = 'var(--ads-overlay)'
// Voile sous les pastilles posées sur une miniature vidéo.
export const thumbOverlay = 'var(--ads-thumb-overlay)'
// Fond des écrans plein cadre (connexion, erreur) : fond de la charte et
// halo violet très diffus (charte §6, jamais de néon).
export const fullscreenBg = 'radial-gradient(ellipse 80% 60% at 50% 0%, var(--ads-halo-strong) 0%, transparent 70%), var(--amerys-bg)'

// Accents violets (charte §2). indigo/accent/spendColor : violet principal
// (labels, liens, éléments actifs). violet : violet clair, utilisé pour
// distinguer la seconde série (Coiffeur, icône RDV) — toujours accompagné
// d'un libellé, jamais seule porteuse d'information.
export const indigo = 'var(--amerys-accent)'
export const violet = 'var(--amerys-accent-light)'
export const accentDeep = 'var(--amerys-accent-deep)'
export const lavender = 'var(--ads-accent-soft)'
export const ctaBorder = 'var(--amerys-cta-border)'
// Texte posé sur un fond plein `accent`.
export const onAccent = 'var(--ads-on-accent)'
// Bouton principal de la charte (fond clair / texte aubergine en nuit,
// inversé en clair).
export const buttonLight = 'var(--amerys-button-light)'
export const buttonLightText = 'var(--amerys-button-text)'

// Statuts (succès, attention, erreur, neutre) : teintes adaptées par thème
// pour garder un contraste texte ≥ 4,5:1 ; toujours doublées d'un libellé.
export const green = 'var(--ads-success)'
export const amber = 'var(--ads-warning)'
export const red = 'var(--ads-danger)'
export const gray = 'var(--ads-neutral)'

// Graphiques : barres (rendez-vous) en violet profond, courbe (montant
// dépensé) en couleur de texte secondaire — séries distinguées par la
// teinte, la luminosité ET la forme (barres / courbe). chartOrange : ancien
// nom conservé pour la courbe dépensé (OverviewChart.tsx).
export const chartBars = 'var(--ads-chart-bars)'
export const chartLine = 'var(--ads-chart-line)'
export const chartOrange = chartLine

// Facebook/Instagram (page Détail campagne) : couleurs de marque, exception
// justifiée — jamais utilisées comme accent général ni comme couleur de
// texte (repères graphiques : points de légende, segments de donut).
// Contraste non textuel ≥ 3:1 vérifié sur les deux thèmes (nuit : 4,4 et
// 4,6:1 sur #15101B ; clair : 4,2 et 4,0:1 sur blanc).
export const facebookBlue = '#1877F2'
export const instagramMagenta = '#E4405F'

// Alias conservés pour les composants existants.
export const accent = indigo
export const spendColor = indigo

// Bandeau d'en-tête : sombre dans les deux thèmes (#100B16 nuit, #24142D
// clair), cohérent avec le badge sombre du symbole officiel (app/brand.ts).
// onDark* : textes et traits posés sur ce bandeau.
export const headerBg = 'var(--ads-header-bg)'
export const onDark = 'var(--ads-on-dark)'
export const onDarkMuted = 'var(--ads-on-dark-muted)'
export const onDarkLine = 'var(--ads-on-dark-line)'
export const onDarkFill = 'var(--ads-on-dark-fill)'
// Bouton principal posé sur le bandeau (identique dans les deux thèmes).
export const headerButton = 'var(--ads-header-button)'
export const headerButtonText = 'var(--ads-header-button-text)'
// Rouge lisible sur le bandeau sombre (9,6:1 nuit, 8,6:1 clair).
export const redOnDark = '#FF9B9B'

export const sidebarWidth = 232

// Fond "chip"/pastille : couleur officielle à opacité réduite. color-mix()
// (et non un découpage hexadécimal) pour accepter les variables CSS.
export function softBg(color: string, alpha = 0.12): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
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
