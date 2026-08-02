// Journalisation légère : erreurs critiques / API / synchro uniquement.
// stdout/stderr (capturé nativement par la plateforme de déploiement,
// aucune dépendance ajoutée). L'appelant reste responsable de ne jamais
// passer de donnée personnelle ni de secret — même règle que l'existant
// (toujours error.message, jamais un objet brut). Filet de sécurité
// supplémentaire ici : certains messages Supabase Auth (ex.
// resetPasswordForEmail sur une adresse mal formée) peuvent, de façon
// non garantie, ré-échoyer l'adresse e-mail dans error.message — observé
// en conditions réelles. Toute sous-chaîne ressemblant à un e-mail est donc
// masquée avant journalisation, quel que soit l'appelant.

export type LogCategory = "api" | "sync" | "critical";

const EMAIL_PATTERN = /[^\s"'<>]+@[^\s"'<>]+\.[^\s"'<>]+/g;

export function logError(category: LogCategory, context: string, message: string): void {
  const sanitized = message.replace(EMAIL_PATTERN, "[email masqué]");
  console.error(`[${category}] ${context} :: ${sanitized}`);
}
