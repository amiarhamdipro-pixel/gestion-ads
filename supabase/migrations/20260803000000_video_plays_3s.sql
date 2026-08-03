-- Ajoute videos.video_plays_3s : vues 3 secondes (Meta action_type
-- video_3_sec_watched_actions), dénominateur du taux d'accroche ("Hook
-- Rate") tel que Meta le calcule lui-même (vues 3s ÷ impressions). La
-- colonne video_plays existante (video_play_actions) est un décompte de
-- lectures différent, non filtré à 3 secondes, qui ne reproduit pas les
-- valeurs affichées par Meta — d'où l'ajout d'une colonne dédiée plutôt que
-- la réutilisation de video_plays. Voir lib/sync/mapper.ts.

alter table public.videos
  add column if not exists video_plays_3s bigint not null default 0 check (video_plays_3s >= 0);
