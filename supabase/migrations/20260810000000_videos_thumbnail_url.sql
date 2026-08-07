-- URL/chemin durable de la miniature vidéo (Supabase Storage, bucket
-- video-thumbnails), distincte de toute URL Meta signée/temporaire (jamais
-- stockée — voir lib/sync/meta.ts, fetchVideoThumbnail). Renseignée par la
-- synchro (lib/sync/syncCampaign.ts) : Meta -> téléchargement serveur ->
-- upload Storage -> URL publique stable écrite ici. NULL tant que non
-- résolue (pas de video_id, pas de miniature Meta, échec de
-- téléchargement/upload — jamais une erreur de synchro, voir le garde-fou
-- de non-régression documenté dans syncCampaign.ts) ou pour toute campagne
-- hors du périmètre du POC (uniquement la campagne n°20 au moment de cette
-- migration, voir BRIEF-CLAUDE-CODE.md).
alter table public.videos
  add column if not exists thumbnail_url text null;
