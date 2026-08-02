// URL publique du site, utilisée pour construire les liens de redirection
// Supabase Auth (réinitialisation de mot de passe). À définir en production
// via NEXT_PUBLIC_SITE_URL (voir README.md) — jamais déduite d'un en-tête
// Host côté serveur (non fiable derrière un proxy mal configuré).
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
