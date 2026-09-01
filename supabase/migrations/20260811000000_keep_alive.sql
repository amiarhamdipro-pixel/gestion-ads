-- Table publique de maintien d'activité (« keep-alive ») : cible dédiée d'une
-- requête de lecture périodique émise par un cron externe centralisé (voir
-- BRIEF-CLAUDE-CODE.md, section « Environnement réel — PRODUCTION ») qui
-- maintient une activité régulière afin de réduire le risque de mise en pause
-- sur le plan Free. Seule une offre Supabase payante garantit l'absence de
-- suspension.
--
-- Ne contient AUCUNE donnée métier : une unique ligne fixe, une seule colonne
-- booléenne servant de singleton. Ne modifie aucune table ni politique
-- existante.
--
-- Modèle d'accès voulu :
--   - anon, authenticated : lecture seule (SELECT) sur l'unique ligne ;
--   - INSERT / UPDATE / DELETE : explicitement refusés aux rôles publics
--     (REVOKE au niveau table + RLS activée sans policy d'écriture).
-- Aucun GRANT à service_role ici (non nécessaire à ce maintien d'activité).
--
-- DOWN (rollback — NON appliqué par ce dépôt, à exécuter manuellement) :
--   drop table if exists public.keep_alive;
--   -- (la policy keep_alive_select_public et les GRANT associés tombent
--   --  automatiquement avec la table)

-- ─── Table + unique ligne fixe ───────────────────────────────────────────────

create table if not exists public.keep_alive (
  singleton boolean primary key default true,
  constraint keep_alive_singleton check (singleton is true)
);

insert into public.keep_alive (singleton) values (true)
  on conflict (singleton) do nothing;

-- ─── Row Level Security ──────────────────────────────────────────────────────

alter table public.keep_alive enable row level security;

drop policy if exists keep_alive_select_public on public.keep_alive;
create policy keep_alive_select_public on public.keep_alive
  for select
  to anon, authenticated
  using (true);

-- Aucune policy INSERT / UPDATE / DELETE : RLS activée => toute écriture par
-- anon ou authenticated est refusée par défaut (aucune policy permissive).

-- ─── Privilèges table (ce projet n'auto-expose pas les nouvelles tables,
-- cf. 20260731000000_grant_data_api_privileges.sql) ─────────────────────────

revoke all on table public.keep_alive from anon, authenticated;
grant select on table public.keep_alive to anon, authenticated;
