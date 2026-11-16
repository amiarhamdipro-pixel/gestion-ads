-- Historique persistant des synchronisations manuelles (bouton admin
-- « Synchroniser » -> /api/admin/sync/all) : une ligne par clic, portant le
-- rapport SyncAllReport déjà émis au navigateur. Table distincte de
-- public.sync_runs, qui reste inchangée : elle journalise chaque campagne Meta
-- (lib/sync/syncCampaign.ts) et alimente « Dernière synchro » du dashboard.
--
-- Accès :
--   - lecture : administrateurs authentifiés, tous clients confondus, via la
--     fonction RLS existante current_user_role() ;
--   - clients et anonymes : aucun accès ;
--   - écritures : exclusivement côté serveur (service_role, qui contourne la
--     RLS) — aucune politique insert/update/delete pour authenticated.
-- Ce projet n'expose pas automatiquement les nouvelles tables à l'API Data
-- (voir 20260731000000_grant_data_api_privileges.sql) : les GRANT sont donc
-- explicites ci-dessous.

create table if not exists public.admin_sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  -- Nullable + set null : l'historique survit à la suppression d'un compte admin.
  started_by uuid references auth.users(id) on delete set null,
  trigger text not null default 'manual' check (trigger in ('manual')),
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed', 'no_campaign')),
  aborted_at_step text
    check (aborted_at_step in ('meta_totals', 'calendly_appointments')),
  target_campaign_number integer,
  total_errors integer not null default 0 check (total_errors >= 0),
  -- Message générique destiné à l'admin (abortMessage), jamais une erreur brute
  -- Meta/Calendly.
  error_message text,
  -- SyncAllReport (app/api/admin/sync/all/route.ts) : compteurs et numéros de
  -- campagne uniquement, aucune donnée personnelle.
  report jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms >= 0),

  -- Une exécution en cours n'a pas de fin ; une exécution terminée en a une.
  constraint admin_sync_runs_finished_consistency
    check ((status = 'running') = (finished_at is null)),
  constraint admin_sync_runs_finished_after_start
    check (finished_at is null or finished_at >= started_at),
  -- Une étape d'interruption n'a de sens que pour un échec.
  constraint admin_sync_runs_aborted_only_when_failed
    check (aborted_at_step is null or status = 'failed')
);

create index if not exists idx_admin_sync_runs_client_started
  on public.admin_sync_runs (client_id, started_at desc);

-- ─── Row Level Security ────────────────────────────────────────────────────

alter table public.admin_sync_runs enable row level security;

-- Lecture : tout administrateur, historiques de tous les clients
-- (current_user_role() : security definer, migration initiale). Un compte
-- client (role = 'client') ou anonyme ne voit rien.
drop policy if exists admin_sync_runs_select_admin_all on public.admin_sync_runs;
create policy admin_sync_runs_select_admin_all on public.admin_sync_runs
  for select
  to authenticated
  using (public.current_user_role() = 'admin');

-- ─── GRANT ─────────────────────────────────────────────────────────────────
-- Point de départ explicite (indépendant des privilèges par défaut du projet),
-- puis ouverture minimale.

revoke all on table public.admin_sync_runs from public, anon, authenticated;

-- authenticated : lecture seule au niveau table ; la politique ci-dessus
-- restreint aux admins. Aucune écriture possible.
grant select on table public.admin_sync_runs to authenticated;

-- service_role : écritures serveur (createAdminClient), RLS contournée.
grant select, insert, update, delete on table public.admin_sync_runs to service_role;
