// URL publique du site, utilisée pour construire les liens de redirection
// Supabase Auth (réinitialisation de mot de passe). À définir en production
// via NEXT_PUBLIC_SITE_URL (voir README.md) — jamais déduite d'un en-tête
// Host côté serveur (non fiable derrière un proxy mal configuré).
//
// 0.0.0.0 n'est jamais une adresse de destination valide dans un navigateur
// (uniquement une adresse d'écoute serveur, "toutes les interfaces") : un
// lien de réinitialisation construit avec cette valeur produit
// ERR_ADDRESS_INVALID côté Chrome. Erreur classique — copiée depuis le
// message "Local: http://0.0.0.0:3000" affiché par `next dev` — donc
// ignorée explicitement ici plutôt que propagée dans un lien d'e-mail :
// repli sur localhost, jamais un lien cassé.
const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
export const SITE_URL = rawSiteUrl && !rawSiteUrl.includes('0.0.0.0') ? rawSiteUrl : 'http://localhost:3000'
