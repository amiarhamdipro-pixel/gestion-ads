-- Nom métier affiché dans le dashboard pour une vidéo : le titre réel du
-- fichier importé dans Meta (node Vidéo, champ title — voir lib/sync/meta.ts,
-- fetchVideoTitle), distinct de videos.name qui reste le nom de la PUB tel
-- que saisi dans Ads Manager. Rempli automatiquement par la synchro pour les
-- campagnes actives (lib/sync/syncCampaign.ts) ; NULL tant que non résolu
-- (pas de video_id, pas de title, permission refusée, pub non vidéo — jamais
-- une erreur de synchro) ou pour les campagnes historiques (n°1 à 11, ancien
-- compte Meta, jamais resynchronisées) où il sera renseigné manuellement.
alter table public.videos
  add column if not exists video_display_name text null;
