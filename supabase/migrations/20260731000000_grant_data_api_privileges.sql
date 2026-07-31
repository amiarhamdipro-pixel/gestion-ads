-- Migration corrective : la migration initiale créait les tables et les
-- politiques RLS mais n'accordait aucun GRANT Postgres aux rôles de l'API
-- Data. Ce projet Supabase n'auto-expose plus les nouvelles tables par
-- défaut (cf. supabase/config.toml, auto_expose_new_tables), d'où les erreurs
-- « permission denied » constatées même pour service_role.
--
-- Les politiques RLS existantes restent inchangées et sont l'unique contrôle
-- d'accès par ligne : ces GRANT ouvrent seulement la porte au niveau table,
-- selon le modèle recommandé par Supabase.
--   - anon          : lecture seule (les politiques RLS actuelles ne
--                     définissent aucun accès anonyme réel : ce GRANT ne
--                     rend donc aucune ligne visible tant qu'aucune policy
--                     n'autorise explicitement anon).
--   - authenticated : CRUD complet au niveau GRANT ; les policies RLS
--                     (admin vs client) restent le filtre réel par ligne.
--   - service_role  : accès complet (bypass RLS déjà assuré par la
--                     plateforme Supabase, GRANT nécessaire en complément).

grant select on table
  public.clients,
  public.profiles,
  public.campaigns,
  public.audiences,
  public.videos,
  public.appointment_breakdowns,
  public.sync_runs
to anon;

grant select, insert, update, delete on table
  public.clients,
  public.profiles,
  public.campaigns,
  public.audiences,
  public.videos,
  public.appointment_breakdowns,
  public.sync_runs
to authenticated, service_role;
