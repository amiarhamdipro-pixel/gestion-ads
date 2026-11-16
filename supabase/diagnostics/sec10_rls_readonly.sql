-- ============================================================================
-- SEC-10 — Diagnostic RLS en LECTURE SEULE (aucune écriture, aucun DDL).
--
-- But : comparer les politiques RLS réellement déployées aux migrations
-- (20260730000000_initial_schema, 20260801000000_appointments,
-- 20260802000000_campaign_daily_stats, 20260731000000_grant_data_api_privileges)
-- avant la correction "campagnes non publiées".
--
-- Exécution : éditeur SQL Supabase. L'éditeur n'affiche que le résultat de la
-- DERNIÈRE requête exécutée : sélectionner un bloc (1 à 8) puis "Run".
-- Aucune requête ne renvoie de donnée personnelle, de jeton ni d'identifiant
-- de client : uniquement des métadonnées de schéma et des comptages globaux.
-- ============================================================================


-- ── 1. Politiques RLS présentes sur les 6 tables ───────────────────────────
-- roles = {public} : politique sans clause TO (s'applique à tous les rôles).
-- uses_published = false sur *_select_own -> la publication n'est PAS
-- appliquée en base (constat attendu d'après les migrations).
select
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual        as using_expression,
  with_check  as with_check_expression,
  coalesce(qual, '') ilike '%published%' as uses_published
from pg_policies
where schemaname = 'public'
  and tablename in ('campaigns', 'audiences', 'videos', 'appointment_breakdowns', 'campaign_daily_stats', 'appointments')
order by tablename, policyname;


-- ── 2. Écart entre politiques attendues (migrations) et déployées ──────────
-- status = 'manquante' : prévue par les migrations, absente en base.
-- status = 'en plus'   : présente en base, absente des migrations
--                        (créée à la main ou par une autre voie) -> à examiner.
with expected(tablename, policyname) as (
  values
    ('campaigns', 'campaigns_admin_all'),
    ('campaigns', 'campaigns_select_own'),
    ('audiences', 'audiences_admin_all'),
    ('audiences', 'audiences_select_own'),
    ('videos', 'videos_admin_all'),
    ('videos', 'videos_select_own'),
    ('appointment_breakdowns', 'appointment_breakdowns_admin_all'),
    ('appointment_breakdowns', 'appointment_breakdowns_select_own'),
    ('campaign_daily_stats', 'campaign_daily_stats_admin_all'),
    ('campaign_daily_stats', 'campaign_daily_stats_select_own'),
    ('appointments', 'appointments_admin_all'),
    ('appointments', 'appointments_select_own')
),
deployed as (
  select tablename, policyname
  from pg_policies
  where schemaname = 'public'
    and tablename in ('campaigns', 'audiences', 'videos', 'appointment_breakdowns', 'campaign_daily_stats', 'appointments')
)
select
  coalesce(e.tablename, d.tablename)   as tablename,
  coalesce(e.policyname, d.policyname) as policyname,
  case
    when d.policyname is null then 'manquante'
    when e.policyname is null then 'en plus'
    else 'conforme'
  end as status
from expected e
full outer join deployed d
  on d.tablename = e.tablename and d.policyname = e.policyname
order by status desc, tablename, policyname;


-- ── 3. RLS activée sur les 6 tables ────────────────────────────────────────
-- rls_enabled doit valoir true partout. rls_forced = false est normal
-- (le propriétaire et service_role contournent la RLS).
select
  c.relname             as tablename,
  c.relrowsecurity      as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('campaigns', 'audiences', 'videos', 'appointment_breakdowns', 'campaign_daily_stats', 'appointments')
order by c.relname;


-- ── 4. Privilèges de table par rôle (GRANT) ────────────────────────────────
-- Attendu d'après les migrations : anon = SELECT seulement ; authenticated et
-- service_role = SELECT/INSERT/UPDATE/DELETE. La RLS reste le filtre réel par
-- ligne pour anon/authenticated ; service_role la contourne.
select
  t.tablename,
  r.rolname as role,
  has_table_privilege(r.rolname, format('public.%I', t.tablename), 'SELECT') as can_select,
  has_table_privilege(r.rolname, format('public.%I', t.tablename), 'INSERT') as can_insert,
  has_table_privilege(r.rolname, format('public.%I', t.tablename), 'UPDATE') as can_update,
  has_table_privilege(r.rolname, format('public.%I', t.tablename), 'DELETE') as can_delete
from (values
  ('campaigns'), ('audiences'), ('videos'), ('appointment_breakdowns'), ('campaign_daily_stats'), ('appointments')
) as t(tablename)
cross join pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role')
order by t.tablename, r.rolname;


-- ── 5. Fonctions RLS : propriétés ──────────────────────────────────────────
-- Attendu : security_definer = true, volatility = 's' (stable),
-- config contenant search_path=public.
select
  p.proname                          as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid)      as returns,
  p.prosecdef                        as security_definer,
  p.provolatile                      as volatility,
  p.proconfig                        as config,
  pg_get_userbyid(p.proowner)        as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_user_role', 'current_user_client_id')
order by p.proname;


-- ── 6. Fonctions RLS : droits EXECUTE ──────────────────────────────────────
-- Attendu : authenticated = true ; anon = false (revoke from public).
-- service_role : true ou false sans impact (il contourne la RLS).
select
  p.proname   as function_name,
  r.rolname   as role,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public'
  and p.proname in ('current_user_role', 'current_user_client_id')
  and r.rolname in ('anon', 'authenticated', 'service_role')
order by p.proname, r.rolname;


-- ── 7. Campagnes publiées / non publiées (comptages globaux) ───────────────
-- unpublished > 0 : données réellement exposées aujourd'hui à un client
-- connecté via l'API (RLS sans filtre published).
select
  count(*) filter (where published)     as published_campaigns,
  count(*) filter (where not published) as unpublished_campaigns,
  count(*)                              as total_campaigns
from public.campaigns;


-- ── 8. Exposition des données liées + RDV non rattachés ────────────────────
-- Une ligne par table. rows_unpublished = lignes lisibles aujourd'hui par un
-- client alors que leur campagne n'est pas publiée. Pour appointments :
-- rows_unassigned = RDV sans campagne (campaign_id IS NULL), dont le sort est
-- la décision n°1 de SEC-10 (visibles ou non pour le client).
select 'audiences' as tablename,
       count(*) filter (where c.published)     as rows_published,
       count(*) filter (where not c.published) as rows_unpublished,
       null::bigint                            as rows_unassigned
from public.audiences a
join public.campaigns c on c.id = a.campaign_id
union all
select 'videos',
       count(*) filter (where c.published),
       count(*) filter (where not c.published),
       null
from public.videos v
join public.audiences a on a.id = v.audience_id
join public.campaigns c on c.id = a.campaign_id
union all
select 'appointment_breakdowns',
       count(*) filter (where c.published),
       count(*) filter (where not c.published),
       null
from public.appointment_breakdowns b
join public.campaigns c on c.id = b.campaign_id
union all
select 'campaign_daily_stats',
       count(*) filter (where c.published),
       count(*) filter (where not c.published),
       null
from public.campaign_daily_stats s
join public.campaigns c on c.id = s.campaign_id
union all
select 'appointments (tous statuts)',
       count(*) filter (where c.published),
       count(*) filter (where c.id is not null and not c.published),
       count(*) filter (where ap.campaign_id is null)
from public.appointments ap
left join public.campaigns c on c.id = ap.campaign_id
union all
select 'appointments (status = active)',
       count(*) filter (where c.published),
       count(*) filter (where c.id is not null and not c.published),
       count(*) filter (where ap.campaign_id is null)
from public.appointments ap
left join public.campaigns c on c.id = ap.campaign_id
where ap.status = 'active';
