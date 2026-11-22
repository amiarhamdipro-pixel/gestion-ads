// Ressources de marque AMERYS ADS — source unique pour toute l'application.
// Fichiers copiés à l'identique depuis le kit officiel Amerys
// (Refonte Amerys Agency/logo/, novembre 2026), dans public/brand/ :
//   - amerys-icone.png (512×512) : symbole « M » officiel (badge circulaire
//     sombre), pour tous les petits emplacements (connexion, en-tête,
//     icône Apple, aperçus de partage) ;
//   - favicon-64.png (64×64) : version favicon du même symbole, source des
//     icônes d'onglet (app/icon.tsx, app/favicon.ico).
// Logos horizontal / carrés du kit non copiés : ils portent « AMERYS AGENCY ·
// DIGITAL MEDIA » alors qu'ADS s'affiche « AMERYS ADS », et aucun
// emplacement de l'application ne les utilise (pas de doublon inutile).
// Constantes uniquement (aucune dépendance Node) : importable côté client.

export const BRAND_NAME = 'AMERYS ADS'
export const BRAND_SUBTITLE = 'Marketing Dashboard'

// Chemins publics (servis par Next.js depuis public/).
export const BRAND_ICON_SRC = '/brand/amerys-icone.png'
export const BRAND_ICON_ALT = 'Amerys'
// Les images générées par next/og lisent ces mêmes fichiers via
// app/brand-image.ts (chemins disque littéraux, requis pour le build).
