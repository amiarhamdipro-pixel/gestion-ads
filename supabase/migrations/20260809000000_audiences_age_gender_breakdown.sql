-- Support de l'import historique Excel étendu (campagnes 1 à 19, voir
-- BRIEF-CLAUDE-CODE.md et scripts/import-historical-excel.ts). Le nouveau
-- fichier source (Synthese_KPI_01_19_Detail.xlsx) ajoute une répartition des
-- leads par genre × tranche d'âge (8 colonnes : Homme/Femme × 18-24/25-34/
-- 35-44/45-54), fournie PAR AUDIENCE (Barber/Coiffeur séparément) — jamais au
-- niveau campagne.
--
-- Aucune destination existante ne correspond à cette granularité :
-- appointment_breakdowns (age_18_24...age_55_plus) est au niveau CAMPAGNE
-- (une ligne par campagne, pas par audience), sans distinction de genre, et
-- avec un palier "55 et +" qui n'existe pas dans ce fichier (4 tranches
-- seulement, 18-24 à 45-54). Forcer cette donnée dans appointment_breakdowns
-- exigerait soit de fusionner les deux audiences (perte de la ventilation
-- Barber/Coiffeur), soit d'inventer une répartition par genre absente du
-- schéma — les deux interdits. D'où ces 8 nouvelles colonnes sur
-- `audiences`, au même niveau que facebook_leads/instagram_leads
-- (migration 20260808000000, même origine et même principe).
--
-- Nullable, jamais 0 par défaut : une audience sans donnée d'âge/genre (toute
-- audience réellement synchronisée via Meta, ou une future ligne du fichier
-- qui laisserait ces cellules vides) doit pouvoir représenter "donnée
-- inconnue", distincte d'un vrai zéro.
alter table public.audiences add column if not exists leads_male_18_24 integer null check (leads_male_18_24 is null or leads_male_18_24 >= 0);
alter table public.audiences add column if not exists leads_male_25_34 integer null check (leads_male_25_34 is null or leads_male_25_34 >= 0);
alter table public.audiences add column if not exists leads_male_35_44 integer null check (leads_male_35_44 is null or leads_male_35_44 >= 0);
alter table public.audiences add column if not exists leads_male_45_54 integer null check (leads_male_45_54 is null or leads_male_45_54 >= 0);
alter table public.audiences add column if not exists leads_female_18_24 integer null check (leads_female_18_24 is null or leads_female_18_24 >= 0);
alter table public.audiences add column if not exists leads_female_25_34 integer null check (leads_female_25_34 is null or leads_female_25_34 >= 0);
alter table public.audiences add column if not exists leads_female_35_44 integer null check (leads_female_35_44 is null or leads_female_35_44 >= 0);
alter table public.audiences add column if not exists leads_female_45_54 integer null check (leads_female_45_54 is null or leads_female_45_54 >= 0);
