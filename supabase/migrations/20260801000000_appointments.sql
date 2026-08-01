-- Table appointments : rendez-vous Calendly, source de vérité pour les RDV
-- réels (voir BRIEF-CLAUDE-CODE.md section 3). Ne modifie aucune migration
-- existante ; réutilise les fonctions RLS et le trigger set_updated_at déjà
-- définis dans 20260730000000_initial_schema.sql.
--
-- Volontairement absent de ce modèle : nom, email, téléphone, réponses
-- libres du formulaire Calendly (donnée personnelle non nécessaire au
-- dashboard — voir lib/calendly/types.ts, CalendlyInvitee).
--
-- acquisition_channel est nullable et texte libre (pas un check contraint à
-- 'instagram'/'facebook') : l'investigation Calendly a montré que le champ
-- réel du formulaire est un canal d'acquisition ouvert (valeurs observées :
-- Instagram, TikTok, Google — pas un sélecteur binaire). Aucune ventilation
-- Barbier/Coiffeur n'existe côté Calendly ; campaign_id reste donc nullable
-- et n'induit aucune répartition par audience.
--
-- Cohérence client/campagne : un rendez-vous rattaché à une campagne (campaign_id
-- non nul) doit obligatoirement porter le même client_id que cette campagne.
-- Appliqué par une clé étrangère composite (campaign_id, client_id) ->
-- campaigns(id, client_id), donc au niveau base plutôt que par trigger : en
-- MATCH SIMPLE (comportement par défaut Postgres), la contrainte est ignorée
-- dès qu'une des deux colonnes est NULL, ce qui autorise nativement
-- campaign_id = null sans cas particulier à coder.

-- Nécessaire pour que la FK composite ci-dessous puisse référencer (id, client_id) ;
-- ajoutée ici (nouvelle migration) plutôt que dans le create table initial de
-- campaigns, qui n'est pas modifié. ADD CONSTRAINT ne supporte pas IF NOT
-- EXISTS en PostgreSQL : garde manuelle via pg_constraint pour rester
-- rejouable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'campaigns_id_client_id_key'
  ) then
    alter table public.campaigns
      add constraint campaigns_id_client_id_key unique (id, client_id);
  end if;
end $$;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  campaign_id uuid,
  calendly_event_uri text not null unique,
  event_type_uri text not null,
  start_time timestamptz not null,
  status text not null check (status in ('active', 'canceled')),
  acquisition_channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_campaign_client_match
    foreign key (campaign_id, client_id) references public.campaigns (id, client_id)
);

-- ─── Index ───────────────────────────────────────────────────────────────

create index if not exists idx_appointments_client_id on public.appointments(client_id);
create index if not exists idx_appointments_campaign_id on public.appointments(campaign_id);

-- ─── updated_at automatique (réutilise public.set_updated_at(), déjà créée) ─

drop trigger if exists set_updated_at on public.appointments;
create trigger set_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

-- ─── Row Level Security (réutilise current_user_role()/current_user_client_id(),
-- déjà créées en security definer dans la migration initiale) ──────────────

alter table public.appointments enable row level security;

drop policy if exists appointments_admin_all on public.appointments;
create policy appointments_admin_all on public.appointments
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists appointments_select_own on public.appointments;
create policy appointments_select_own on public.appointments
  for select
  using (client_id = public.current_user_client_id());

-- ─── GRANT (nécessaire : ce projet n'auto-expose pas les nouvelles tables,
-- cf. 20260731000000_grant_data_api_privileges.sql) ─────────────────────────

grant select on table public.appointments to anon;
grant select, insert, update, delete on table public.appointments to authenticated, service_role;
