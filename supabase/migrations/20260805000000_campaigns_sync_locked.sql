-- Verrouillage définitif de synchro, indépendant du statut Meta
-- (campaigns.status) et de la publication dashboard (campaigns.published).
-- sync_locked=true : la campagne n'est plus jamais resynchronisée (ni Meta
-- ni Calendly, voir lib/sync/syncAllCampaigns.ts, syncAllCampaignsDailyStats.ts,
-- syncAppointments.ts) — ses valeurs deviennent une référence historique figée.
-- Défaut false : toute nouvelle campagne (dont les futures) continue d'être
-- synchronisée normalement, sans action requise.
alter table public.campaigns
  add column if not exists sync_locked boolean not null default false;
