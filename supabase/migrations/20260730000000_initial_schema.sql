-- Phase 1 — schéma initial : clients, profils, campagnes, audiences, vidéos,
-- répartition des rendez-vous, historique de synchro. RLS multi-clients.

create extension if not exists "pgcrypto";

-- ─── Tables ──────────────────────────────────────────────────────────────

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id),
  role text not null check (role in ('admin', 'client')),
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  meta_campaign_id text not null,
  campaign_number integer not null,
  name text not null,
  start_date date,
  end_date date,
  status text,
  meta_spend numeric not null default 0 check (meta_spend >= 0),
  meta_pixel_leads integer not null default 0 check (meta_pixel_leads >= 0),
  calendly_appointments integer not null default 0 check (calendly_appointments >= 0),
  manual_appointments_adjustment integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, campaign_number)
);

create table if not exists public.audiences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  meta_adset_id text not null,
  audience_type text not null check (audience_type in ('barbier', 'coiffeur')),
  name text not null,
  meta_spend numeric not null default 0 check (meta_spend >= 0),
  meta_pixel_leads integer not null default 0 check (meta_pixel_leads >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, audience_type),
  unique (meta_adset_id)
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  audience_id uuid not null references public.audiences(id) on delete cascade,
  meta_ad_id text not null unique,
  name text not null,
  impressions bigint not null default 0 check (impressions >= 0),
  video_plays bigint not null default 0 check (video_plays >= 0),
  thruplays bigint not null default 0 check (thruplays >= 0),
  average_watch_time_seconds numeric not null default 0 check (average_watch_time_seconds >= 0),
  video_p25 bigint not null default 0 check (video_p25 >= 0),
  video_p50 bigint not null default 0 check (video_p50 >= 0),
  video_p75 bigint not null default 0 check (video_p75 >= 0),
  video_p100 bigint not null default 0 check (video_p100 >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointment_breakdowns (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.campaigns(id) on delete cascade,
  instagram_count integer not null default 0 check (instagram_count >= 0),
  facebook_count integer not null default 0 check (facebook_count >= 0),
  age_18_24 integer not null default 0 check (age_18_24 >= 0),
  age_25_34 integer not null default 0 check (age_25_34 >= 0),
  age_35_44 integer not null default 0 check (age_35_44 >= 0),
  age_45_54 integer not null default 0 check (age_45_54 >= 0),
  age_55_plus integer not null default 0 check (age_55_plus >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  started_by uuid references auth.users(id),
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

-- ─── Index ───────────────────────────────────────────────────────────────

create index if not exists idx_campaigns_client_id on public.campaigns(client_id);
create index if not exists idx_audiences_campaign_id on public.audiences(campaign_id);
create index if not exists idx_videos_audience_id on public.videos(audience_id);
create index if not exists idx_sync_runs_client_id on public.sync_runs(client_id);

-- ─── updated_at automatique ──────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.campaigns;
create trigger set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.audiences;
create trigger set_updated_at before update on public.audiences
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.videos;
create trigger set_updated_at before update on public.videos
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.appointment_breakdowns;
create trigger set_updated_at before update on public.appointment_breakdowns
  for each row execute function public.set_updated_at();

-- ─── Fonctions RLS (security definer, évitent la récursion sur profiles) ──

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_client_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select client_id from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_client_id() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_client_id() to authenticated;

-- ─── Row Level Security ────────────────────────────────────────────────────

alter table public.clients enable row level security;
alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.audiences enable row level security;
alter table public.videos enable row level security;
alter table public.appointment_breakdowns enable row level security;
alter table public.sync_runs enable row level security;

-- profiles : lecture de son propre profil, admin lit/écrit tout. Pas de sous-requête
-- sur profiles ici : current_user_role()/current_user_client_id() sont security definer
-- et ne redéclenchent pas RLS sur profiles (pas de récursion).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using (id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- clients : admin tout, client lit uniquement son propre client.
drop policy if exists clients_admin_all on public.clients;
create policy clients_admin_all on public.clients
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists clients_select_own on public.clients;
create policy clients_select_own on public.clients
  for select
  using (id = public.current_user_client_id());

-- campaigns : admin tout, client lit ses propres campagnes.
drop policy if exists campaigns_admin_all on public.campaigns;
create policy campaigns_admin_all on public.campaigns
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists campaigns_select_own on public.campaigns;
create policy campaigns_select_own on public.campaigns
  for select
  using (client_id = public.current_user_client_id());

-- audiences : rattachement indirect via campaigns.client_id.
drop policy if exists audiences_admin_all on public.audiences;
create policy audiences_admin_all on public.audiences
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists audiences_select_own on public.audiences;
create policy audiences_select_own on public.audiences
  for select
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = audiences.campaign_id
        and c.client_id = public.current_user_client_id()
    )
  );

-- videos : rattachement indirect via audiences -> campaigns.client_id.
drop policy if exists videos_admin_all on public.videos;
create policy videos_admin_all on public.videos
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists videos_select_own on public.videos;
create policy videos_select_own on public.videos
  for select
  using (
    exists (
      select 1
      from public.audiences a
      join public.campaigns c on c.id = a.campaign_id
      where a.id = videos.audience_id
        and c.client_id = public.current_user_client_id()
    )
  );

-- appointment_breakdowns : rattachement indirect via campaigns.client_id.
drop policy if exists appointment_breakdowns_admin_all on public.appointment_breakdowns;
create policy appointment_breakdowns_admin_all on public.appointment_breakdowns
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists appointment_breakdowns_select_own on public.appointment_breakdowns;
create policy appointment_breakdowns_select_own on public.appointment_breakdowns
  for select
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = appointment_breakdowns.campaign_id
        and c.client_id = public.current_user_client_id()
    )
  );

-- sync_runs : table technique, réservée à l'admin (écart de tracking / historique
-- de synchro non visible côté client).
drop policy if exists sync_runs_admin_all on public.sync_runs;
create policy sync_runs_admin_all on public.sync_runs
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
