-- Table campaign_daily_stats : statistiques Meta/Calendly agrégées par jour
-- et par campagne. Préparation du futur filtre de période (voir
-- BRIEF-CLAUDE-CODE.md) : le filtre précédent a été retiré parce qu'il
-- comptait une campagne avec la totalité de ses données historiques dès
-- qu'elle chevauchait la période choisie, faute de granularité journalière —
-- cette table fournira cette granularité une fois une synchro quotidienne
-- branchée. Hors périmètre de cette migration : aucune synchro Meta/Calendly,
-- aucune UI, aucune donnée insérée. Ne modifie aucune migration existante ;
-- réutilise set_updated_at(), current_user_role(), current_user_client_id()
-- déjà créées dans 20260730000000_initial_schema.sql, et la contrainte
-- unique campaigns_id_client_id_key déjà ajoutée par
-- 20260801000000_appointments.sql (appliquée avant celle-ci dans l'ordre des
-- migrations).
--
-- Cohérence client/campagne : même mécanisme que appointments (clé étrangère
-- composite (campaign_id, client_id) -> campaigns(id, client_id)). Ici
-- campaign_id est NOT NULL (une ligne de stats appartient toujours à une
-- campagne précise), donc la cohérence client/campagne est garantie pour
-- chaque ligne, pas seulement quand campaign_id est renseigné.

create table if not exists public.campaign_daily_stats (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  campaign_id uuid not null,
  stat_date date not null,
  meta_spend numeric not null default 0 check (meta_spend >= 0),
  meta_pixel_leads integer not null default 0 check (meta_pixel_leads >= 0),
  calendly_appointments integer not null default 0 check (calendly_appointments >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_daily_stats_campaign_client_match
    foreign key (campaign_id, client_id) references public.campaigns (id, client_id),
  -- Idempotence par campagne + date : une synchro quotidienne peut être
  -- rejouée pour un même jour sans dupliquer de ligne (upsert onConflict
  -- campaign_id,stat_date le moment venu).
  constraint campaign_daily_stats_campaign_date_key unique (campaign_id, stat_date)
);

-- ─── Index ───────────────────────────────────────────────────────────────

create index if not exists idx_campaign_daily_stats_client_id on public.campaign_daily_stats(client_id);
create index if not exists idx_campaign_daily_stats_campaign_id on public.campaign_daily_stats(campaign_id);
create index if not exists idx_campaign_daily_stats_stat_date on public.campaign_daily_stats(stat_date);

-- ─── updated_at automatique (réutilise public.set_updated_at(), déjà créée) ─

drop trigger if exists set_updated_at on public.campaign_daily_stats;
create trigger set_updated_at before update on public.campaign_daily_stats
  for each row execute function public.set_updated_at();

-- ─── Row Level Security (réutilise current_user_role()/current_user_client_id(),
-- déjà créées en security definer dans la migration initiale) ──────────────

alter table public.campaign_daily_stats enable row level security;

drop policy if exists campaign_daily_stats_admin_all on public.campaign_daily_stats;
create policy campaign_daily_stats_admin_all on public.campaign_daily_stats
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists campaign_daily_stats_select_own on public.campaign_daily_stats;
create policy campaign_daily_stats_select_own on public.campaign_daily_stats
  for select
  using (client_id = public.current_user_client_id());

-- ─── GRANT (nécessaire : ce projet n'auto-expose pas les nouvelles tables,
-- cf. 20260731000000_grant_data_api_privileges.sql) ─────────────────────────

grant select on table public.campaign_daily_stats to anon;
grant select, insert, update, delete on table public.campaign_daily_stats to authenticated, service_role;
