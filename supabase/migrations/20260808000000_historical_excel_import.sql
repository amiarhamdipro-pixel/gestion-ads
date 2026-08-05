-- Support de l'import historique Excel (campagnes 1 à 12, voir
-- BRIEF-CLAUDE-CODE.md et lib/import/importHistoricalExcel.ts). Le fichier
-- source (Synthese_KPI_01_12_Detail.xlsx) ne fournit pas les métriques Meta
-- brutes détaillées par pub (impressions, video_plays_3s, thruplays,
-- video_p25/p50/p75/p100 : pas de colonne équivalente), seulement des
-- pourcentages déjà calculés (Accroche %, Rétention %) et une répartition de
-- leads par plateforme (Facebook/Instagram) par audience.

-- 1. Vidéos historiques : les métriques Meta détaillées n'existent pas pour
-- les campagnes importées depuis Excel (nouvelles lignes, campagnes 1 à 11 —
-- la campagne 12 avait déjà des lignes vidéos réelles issues d'une synchro
-- Meta antérieure et n'est pas concernée par ce cas). Rendues nullables pour
-- représenter honnêtement "donnée absente" (NULL), jamais 0 par défaut
-- (0 impliquerait une valeur réelle mesurée à zéro). Les vidéos réellement
-- synchronisées via Meta (lib/sync/mapper.ts, mapAdToVideoInsert) continuent
-- de toujours fournir un nombre réel pour ces colonnes, jamais affectées.
alter table public.videos alter column impressions drop not null;
alter table public.videos alter column impressions drop default;
alter table public.videos alter column video_plays_3s drop not null;
alter table public.videos alter column video_plays_3s drop default;
alter table public.videos alter column thruplays drop not null;
alter table public.videos alter column thruplays drop default;
alter table public.videos alter column video_p25 drop not null;
alter table public.videos alter column video_p25 drop default;
alter table public.videos alter column video_p50 drop not null;
alter table public.videos alter column video_p50 drop default;
alter table public.videos alter column video_p75 drop not null;
alter table public.videos alter column video_p75 drop default;
alter table public.videos alter column video_p100 drop not null;
alter table public.videos alter column video_p100 drop default;

-- 2. Taux d'accroche / de rétention déjà calculés (colonnes Excel "Accroche
-- %"/"Retention %"), stockés en ratio 0-1 (comme hookRate()/retentionRate()
-- dans lib/calculations.ts, jamais en pourcentage brut) pour rester
-- affichables via le même formatPct() que les campagnes synchronisées via
-- Meta. Utilisés UNIQUEMENT quand les compteurs bruts (video_plays_3s,
-- impressions, video_p100 ci-dessus) sont absents — l'appelant (page détail
-- campagne) préfère toujours le calcul réel quand les compteurs existent.
-- Nullable, jamais 0 par défaut (case vide Excel = donnée inconnue, pas un
-- taux nul).
alter table public.videos add column if not exists hook_rate_pct numeric null;
alter table public.videos add column if not exists retention_rate_pct numeric null;

-- 3. Répartition des leads par plateforme (Facebook/Instagram), par audience
-- (Barbier/Coiffeur) — donnée présente dans le fichier Excel sans équivalent
-- existant ailleurs dans le schéma (appointment_breakdowns.instagram_count/
-- facebook_count est au niveau CAMPAGNE, pas par audience, et compte des
-- rendez-vous Calendly, pas des leads — notion différente, non réutilisée
-- ici). Nullable : jamais renseigné par la synchro Meta réelle.
alter table public.audiences add column if not exists facebook_leads integer null check (facebook_leads is null or facebook_leads >= 0);
alter table public.audiences add column if not exists instagram_leads integer null check (instagram_leads is null or instagram_leads >= 0);
