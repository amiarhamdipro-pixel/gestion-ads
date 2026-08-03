-- Sépare l'état Meta (campaigns.status : ACTIVE/PAUSED/ARCHIVED, usage
-- interne synchro) de l'état de publication dashboard (campaigns.published :
-- visibilité côté client). Défaut false : toute nouvelle campagne détectée
-- par la synchro est invisible côté client tant qu'un admin ne la publie pas
-- explicitement (voir app/api/admin/campaigns/publish/route.ts). Aucun
-- changement RLS : les policies campaigns_admin_all/campaigns_select_own
-- existantes couvrent déjà la lecture (admin : tout ; client : son propre
-- client_id, sans notion de statut) et l'écriture (admin : for all) sans
-- modification — le filtrage published pour le client se fait entièrement
-- côté application, comme le filtrage status existant qu'il remplace.
alter table public.campaigns
  add column if not exists published boolean not null default false;
