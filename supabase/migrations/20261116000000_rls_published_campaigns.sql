-- ============================================================================
-- SEC-10 — Lecture client limitée aux campagnes PUBLIÉES, au niveau RLS.
--
-- Avant : les six politiques *_select_own ne filtraient que sur
-- client_id = current_user_client_id() (rôle {public}). La notion de
-- publication (campaigns.published, 20260804000000_campaigns_published.sql)
-- n'était appliquée que côté application : un client connecté pouvait lire
-- via l'API Data les campagnes non publiées de son client et leurs données.
--
-- Après :
--   - client (authenticated) : lecture uniquement des lignes rattachées à une
--     campagne published = true de son client, sur les six tables ;
--   - appointments : les RDV sans campagne (campaign_id IS NULL) ne sont plus
--     lisibles par le client ;
--   - politiques limitées explicitement au rôle authenticated (anon : aucune
--     politique de lecture, donc aucune ligne).
--
-- Inchangé : politiques *_admin_all, GRANT, fonctions, service_role (contourne
-- la RLS), données métier, filtres applicatifs.
--
-- Stratégie :
--   - ALTER POLICY (et non DROP/CREATE) : mêmes noms, même commande SELECT,
--     seuls le rôle cible et l'expression USING changent ;
--   - un seul bloc DO = une seule instruction, donc atomique quel que soit le
--     client d'exécution (CLI, éditeur SQL, psql) : toute exception annule
--     l'ensemble, y compris les ALTER déjà passés ;
--   - une seule source de vérité (table de spécification `spec` ci-dessous) :
--     les mêmes textes servent aux vérifications ET aux ALTER POLICY ;
--   - comparaison EXACTE des expressions après normalisation PostgreSQL :
--     chaque expression attendue est installée sur une politique sonde
--     temporaire (sec10_probe), son texte normalisé (pg_policies.qual /
--     with_check) est relu puis la sonde est supprimée, dans la même
--     transaction (jamais visible d'une autre session). On compare alors
--     texte normalisé à texte normalisé : indépendant des espaces, des
--     parenthèses, de la qualification public. et de la version de Postgres ;
--   - préconditions bloquantes sur les 12 politiques (nom, commande,
--     permissivité, rôles, USING, WITH CHECK) AVANT toute modification,
--     postconditions identiques APRÈS : tout écart annule la migration ;
--   - lock_timeout local de 5 s : ALTER/CREATE POLICY prennent un verrou
--     exclusif bref sur chaque table ; en cas d'attente, échec propre.
--
-- Aucune fonction créée : current_user_client_id() / current_user_role()
-- existantes suffisent. Les sous-requêtes sur campaigns restent soumises à la
-- RLS de campaigns (déjà restreinte ici), ce qui est cohérent.
--
-- Retour arrière : supabase/diagnostics/sec10_rls_rollback.sql.
-- Contrôles après application : section VALIDATION en fin de fichier
-- (commentée, à exécuter séparément) + supabase/diagnostics/sec10_rls_readonly.sql.
-- ============================================================================

do $sec10$
declare
  -- Expression des politiques *_admin_all (USING et WITH CHECK), inchangée.
  c_admin constant text := $e$public.current_user_role() = 'admin'$e$;
  r       record;
  v_pol   record;
  v_exp   record;
  v_extra text;
begin
  perform set_config('lock_timeout', '5s', true);

  -- Spécification : définitions d'origine (migrations 20260730, 20260801,
  -- 20260802) et définitions SEC-10. Table temporaire supprimée au COMMIT.
  create temporary table sec10_spec (tbl text primary key, old_using text not null, new_using text not null)
    on commit drop;
  insert into sec10_spec values
    ('campaigns',
     $u$client_id = public.current_user_client_id()$u$,
     $u$client_id = public.current_user_client_id()
      and published$u$),
    ('audiences',
     $u$exists (
        select 1 from public.campaigns c
        where c.id = audiences.campaign_id
          and c.client_id = public.current_user_client_id()
      )$u$,
     $u$exists (
        select 1 from public.campaigns c
        where c.id = audiences.campaign_id
          and c.client_id = public.current_user_client_id()
          and c.published
      )$u$),
    ('videos',
     $u$exists (
        select 1
        from public.audiences a
        join public.campaigns c on c.id = a.campaign_id
        where a.id = videos.audience_id
          and c.client_id = public.current_user_client_id()
      )$u$,
     $u$exists (
        select 1
        from public.audiences a
        join public.campaigns c on c.id = a.campaign_id
        where a.id = videos.audience_id
          and c.client_id = public.current_user_client_id()
          and c.published
      )$u$),
    ('appointment_breakdowns',
     $u$exists (
        select 1 from public.campaigns c
        where c.id = appointment_breakdowns.campaign_id
          and c.client_id = public.current_user_client_id()
      )$u$,
     $u$exists (
        select 1 from public.campaigns c
        where c.id = appointment_breakdowns.campaign_id
          and c.client_id = public.current_user_client_id()
          and c.published
      )$u$),
    ('campaign_daily_stats',
     $u$client_id = public.current_user_client_id()$u$,
     $u$client_id = public.current_user_client_id()
      and exists (
        select 1 from public.campaigns c
        where c.id = campaign_daily_stats.campaign_id
          and c.client_id = public.current_user_client_id()
          and c.published
      )$u$),
    ('appointments',
     $u$client_id = public.current_user_client_id()$u$,
     $u$client_id = public.current_user_client_id()
      and campaign_id is not null
      and exists (
        select 1 from public.campaigns c
        where c.id = appointments.campaign_id
          and c.client_id = public.current_user_client_id()
          and c.published
      )$u$);

  -- ── Préconditions (bloquantes, aucune modification avant ce point) ──────

  -- P1. Rôle cible.
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'SEC-10 précondition : rôle authenticated introuvable';
  end if;

  -- P2. Fonctions RLS existantes, security definer, exécutables par authenticated.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_user_client_id'
      and p.pronargs = 0 and p.prosecdef and p.prorettype = 'uuid'::regtype
  ) then
    raise exception 'SEC-10 précondition : public.current_user_client_id() absente ou non security definer';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_user_role'
      and p.pronargs = 0 and p.prosecdef and p.prorettype = 'text'::regtype
  ) then
    raise exception 'SEC-10 précondition : public.current_user_role() absente ou non security definer';
  end if;
  if not has_function_privilege('authenticated', 'public.current_user_client_id()', 'EXECUTE') then
    raise exception 'SEC-10 précondition : authenticated ne peut pas exécuter current_user_client_id()';
  end if;

  -- P3. Colonne campaigns.published (boolean NOT NULL).
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'campaigns'
      and column_name = 'published' and data_type = 'boolean' and is_nullable = 'NO'
  ) then
    raise exception 'SEC-10 précondition : colonne campaigns.published absente ou nullable';
  end if;

  -- P4. Les six tables existent et ont la RLS activée.
  for r in select tbl from sec10_spec loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = r.tbl
        and c.relkind = 'r' and c.relrowsecurity
    ) then
      raise exception 'SEC-10 précondition : table public.% absente ou RLS désactivée', r.tbl;
    end if;
  end loop;

  -- P5. Exactement les 12 politiques attendues : aucune en plus (une
  -- politique permissive supplémentaire s'ajouterait en OR et annulerait la
  -- restriction ; couvre aussi une sonde sec10_probe résiduelle), aucune
  -- manquante.
  select string_agg(format('%s.%s', tablename, policyname), ', ' order by tablename, policyname)
    into v_extra
  from pg_policies
  where schemaname = 'public'
    and tablename in (select tbl from sec10_spec)
    and policyname not in (tablename || '_admin_all', tablename || '_select_own');
  if v_extra is not null then
    raise exception 'SEC-10 précondition : politiques inattendues : %', v_extra;
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename in (select tbl from sec10_spec)) <> 12 then
    raise exception 'SEC-10 précondition : les 12 politiques attendues ne sont pas toutes présentes';
  end if;

  -- P6. Définition exacte de chaque politique (après normalisation Postgres).
  for r in select * from sec10_spec order by tbl loop
    -- *_admin_all : FOR ALL, permissive, {public}, USING et WITH CHECK = c_admin.
    execute format('create policy sec10_probe on public.%I as permissive for all to public using (%s) with check (%s)',
                   r.tbl, c_admin, c_admin);
    select qual, with_check into v_exp from pg_policies
      where schemaname = 'public' and tablename = r.tbl and policyname = 'sec10_probe';
    execute format('drop policy sec10_probe on public.%I', r.tbl);

    select * into v_pol from pg_policies
      where schemaname = 'public' and tablename = r.tbl and policyname = r.tbl || '_admin_all';
    if not found or v_pol.cmd <> 'ALL' or v_pol.permissive <> 'PERMISSIVE'
       or v_pol.roles <> array['public']::name[]
       or v_pol.qual is distinct from v_exp.qual
       or v_pol.with_check is distinct from v_exp.with_check then
      raise exception 'SEC-10 précondition : %_admin_all diverge (cmd=%, roles=%, using=%, check=%)',
        r.tbl, v_pol.cmd, v_pol.roles, v_pol.qual, v_pol.with_check;
    end if;

    -- *_select_own : définition d'origine, FOR SELECT, permissive, {public}, sans WITH CHECK.
    execute format('create policy sec10_probe on public.%I as permissive for select to public using (%s)',
                   r.tbl, r.old_using);
    select qual into v_exp from pg_policies
      where schemaname = 'public' and tablename = r.tbl and policyname = 'sec10_probe';
    execute format('drop policy sec10_probe on public.%I', r.tbl);

    select * into v_pol from pg_policies
      where schemaname = 'public' and tablename = r.tbl and policyname = r.tbl || '_select_own';
    if not found or v_pol.cmd <> 'SELECT' or v_pol.permissive <> 'PERMISSIVE'
       or v_pol.roles <> array['public']::name[]
       or v_pol.with_check is not null
       or v_pol.qual is distinct from v_exp.qual then
      raise exception 'SEC-10 précondition : %_select_own diverge de sa définition d''origine (déjà migrée ?) roles=%, using=%',
        r.tbl, v_pol.roles, v_pol.qual;
    end if;
  end loop;

  -- ── Modifications : six politiques *_select_own uniquement ─────────────

  for r in select * from sec10_spec order by tbl loop
    execute format('alter policy %I on public.%I to authenticated using (%s)',
                   r.tbl || '_select_own', r.tbl, r.new_using);
  end loop;

  -- ── Postconditions (toute anomalie annule l'ensemble) ──────────────────

  for r in select * from sec10_spec order by tbl loop
    execute format('create policy sec10_probe on public.%I as permissive for select to authenticated using (%s)',
                   r.tbl, r.new_using);
    select qual into v_exp from pg_policies
      where schemaname = 'public' and tablename = r.tbl and policyname = 'sec10_probe';
    execute format('drop policy sec10_probe on public.%I', r.tbl);

    select * into v_pol from pg_policies
      where schemaname = 'public' and tablename = r.tbl and policyname = r.tbl || '_select_own';
    if not found or v_pol.cmd <> 'SELECT' or v_pol.permissive <> 'PERMISSIVE'
       or v_pol.roles <> array['authenticated']::name[]
       or v_pol.with_check is not null
       or v_pol.qual is distinct from v_exp.qual then
      raise exception 'SEC-10 postcondition : %_select_own inattendue après modification', r.tbl;
    end if;

    execute format('create policy sec10_probe on public.%I as permissive for all to public using (%s) with check (%s)',
                   r.tbl, c_admin, c_admin);
    select qual, with_check into v_exp from pg_policies
      where schemaname = 'public' and tablename = r.tbl and policyname = 'sec10_probe';
    execute format('drop policy sec10_probe on public.%I', r.tbl);

    select * into v_pol from pg_policies
      where schemaname = 'public' and tablename = r.tbl and policyname = r.tbl || '_admin_all';
    if not found or v_pol.cmd <> 'ALL' or v_pol.permissive <> 'PERMISSIVE'
       or v_pol.roles <> array['public']::name[]
       or v_pol.qual is distinct from v_exp.qual
       or v_pol.with_check is distinct from v_exp.with_check then
      raise exception 'SEC-10 postcondition : %_admin_all modifiée', r.tbl;
    end if;
  end loop;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename in (select tbl from sec10_spec)) <> 12 then
    raise exception 'SEC-10 postcondition : nombre de politiques différent de 12';
  end if;

  drop table sec10_spec;
  raise notice 'SEC-10 : 6 politiques *_select_own restreintes aux campagnes publiées (rôle authenticated).';
end
$sec10$;


-- ============================================================================
-- VALIDATION APRÈS APPLICATION (commentée : à exécuter séparément dans
-- l'éditeur SQL Supabase). Lecture seule.
--
-- V1. Définitions déployées : *_select_own -> roles = {authenticated},
--     uses_published = true ; *_admin_all -> roles = {public}, inchangées.
--
-- select tablename, policyname, roles, cmd,
--        qual ilike '%published%' as uses_published
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('campaigns', 'audiences', 'videos', 'appointment_breakdowns', 'campaign_daily_stats', 'appointments')
-- order by tablename, policyname;
--
-- V2. GRANT inchangés : relancer le bloc 4 de
--     supabase/diagnostics/sec10_rls_readonly.sql (résultat identique à
--     celui obtenu avant application).
--
-- V3 / V4. Simulation d'un utilisateur réel : accès AUTORISÉS et INTERDITS.
--   V3 : <UUID_UTILISATEUR> = id auth d'un compte CLIENT de test, idéalement
--        avec au moins une campagne publiée ET une non publiée.
--   V4 : même bloc avec l'id d'un compte ADMIN.
--   Ne pas partager la valeur de <UUID_UTILISATEUR>.
--
--   Déroulement (tout le bloc d'un coup, éditeur SQL Supabase ou psql) :
--     1. BEGIN ; paramètres et identité JWT posés en LOCAL (transaction) ;
--     2. en propriétaire (RLS non appliquée), calcul de l'ensemble EXACT des
--        lignes que l'utilisateur doit voir d'après son profil :
--          - client : lignes rattachées aux campagnes publiées de SON client ;
--          - admin  : toutes les lignes ;
--        et des compteurs d'accès interdits attendus selon le rôle :
--          - client : 0 campagne/RDV d'un autre client, 0 campagne non
--            publiée, 0 RDV sans campagne ;
--          - admin  : les totaux globaux (accès complet, RDV non rattachés
--            compris) ;
--     3. SET LOCAL ROLE authenticated : mesures sous RLS, avec preuve que le
--        rôle et le JWT sont actifs PENDANT ces requêtes (current_user,
--        auth.uid(), claim role) ;
--     4. rapport figé dans une instruction préparée (sec10_report), puis
--        ROLLBACK : rôle, JWT et paramètres annulés, rien n'est écrit ;
--     5. EXECUTE sec10_report : affiche le rapport. L'éditeur SQL n'affiche
--        que le résultat de la DERNIÈRE instruction : c'est pourquoi le
--        rapport est lu après le ROLLBACK (une instruction préparée n'est pas
--        annulée par ROLLBACK ; elle ne contient que le rapport).
--
--   Lecture du rapport : une ligne par contrôle, ok = true attendu partout,
--   dernière ligne « BILAN » = true. Comparaison de chaque table par nombre
--   de lignes ET empreinte md5 des identifiants (égalité d'ensemble : ni
--   ligne manquante, ni ligne en trop). Aucune donnée personnelle ni
--   identifiant affiché : comptages, empreintes comparées, booléens.
--
-- begin;
-- select set_config('sec10.uid', '<UUID_UTILISATEUR>', true);
-- select set_config('request.jwt.claims',
--   json_build_object('sub', current_setting('sec10.uid'), 'role', 'authenticated')::text, true);
-- select set_config('sec10.expected', (
--   with p as (select role, client_id from public.profiles where id = current_setting('sec10.uid')::uuid),
--   vc as (select c.* from public.campaigns c, p
--          where p.role = 'admin' or (c.client_id = p.client_id and c.published)),
--   va as (select a.* from public.audiences a, p
--          where p.role = 'admin' or a.campaign_id in (select id from vc)),
--   vv as (select v.* from public.videos v, p
--          where p.role = 'admin' or v.audience_id in (select id from va)),
--   vb as (select b.* from public.appointment_breakdowns b, p
--          where p.role = 'admin' or b.campaign_id in (select id from vc)),
--   vs as (select s.* from public.campaign_daily_stats s, p
--          where p.role = 'admin' or (s.client_id = p.client_id and s.campaign_id in (select id from vc))),
--   vap as (select ap.* from public.appointments ap, p
--           where p.role = 'admin' or (ap.client_id = p.client_id and ap.campaign_id in (select id from vc)))
--   select json_build_object(
--     'profil', (select role from p),
--     'campaigns',              json_build_object('n', (select count(*) from vc),  'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from vc)),
--     'audiences',              json_build_object('n', (select count(*) from va),  'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from va)),
--     'videos',                 json_build_object('n', (select count(*) from vv),  'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from vv)),
--     'appointment_breakdowns', json_build_object('n', (select count(*) from vb),  'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from vb)),
--     'campaign_daily_stats',   json_build_object('n', (select count(*) from vs),  'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from vs)),
--     'appointments',           json_build_object('n', (select count(*) from vap), 'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from vap)),
--     -- Accès sensibles : 0 pour un client, totaux globaux pour un admin.
--     'campagnes d''autres clients', (select case when p.role = 'admin'
--         then (select count(*) from public.campaigns c where c.client_id is distinct from p.client_id) else 0 end from p),
--     'RDV d''autres clients',       (select case when p.role = 'admin'
--         then (select count(*) from public.appointments ap where ap.client_id is distinct from p.client_id) else 0 end from p),
--     'campagnes non publiées',      (select case when p.role = 'admin'
--         then (select count(*) from public.campaigns c where not c.published) else 0 end from p),
--     'RDV sans campagne',           (select case when p.role = 'admin'
--         then (select count(*) from public.appointments ap where ap.campaign_id is null) else 0 end from p)
--   )::text), true);
-- set local role authenticated;
-- select set_config('sec10.observed', json_build_object(
--     'role', current_user,
--     'jwt', coalesce(auth.uid()::text = current_setting('sec10.uid')
--                     and current_setting('request.jwt.claims', true)::json->>'role' = 'authenticated', false),
--     'profil', public.current_user_role(),
--     'campaigns',              json_build_object('n', (select count(*) from public.campaigns),              'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.campaigns)),
--     'audiences',              json_build_object('n', (select count(*) from public.audiences),              'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.audiences)),
--     'videos',                 json_build_object('n', (select count(*) from public.videos),                 'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.videos)),
--     'appointment_breakdowns', json_build_object('n', (select count(*) from public.appointment_breakdowns), 'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.appointment_breakdowns)),
--     'campaign_daily_stats',   json_build_object('n', (select count(*) from public.campaign_daily_stats),   'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.campaign_daily_stats)),
--     'appointments',           json_build_object('n', (select count(*) from public.appointments),           'h', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.appointments)),
--     'campagnes d''autres clients', (select count(*) from public.campaigns where client_id is distinct from public.current_user_client_id()),
--     'RDV d''autres clients',       (select count(*) from public.appointments where client_id is distinct from public.current_user_client_id()),
--     'campagnes non publiées',      (select count(*) from public.campaigns where not published),
--     'RDV sans campagne',           (select count(*) from public.appointments where campaign_id is null)
--   )::text, true);
-- reset role;
-- do $sec10_report$
-- declare
--   e json := current_setting('sec10.expected')::json;
--   o json := current_setting('sec10.observed')::json;
--   r json;
-- begin
--   with checks(n, controle, attendu, observe, ok) as (
--     select 1, 'rôle effectif pendant les mesures', 'authenticated', o->>'role', o->>'role' = 'authenticated'
--     union all
--     select 2, 'JWT actif (auth.uid() = compte testé, claim role)', 'true', o->>'jwt', o->>'jwt' = 'true'
--     union all
--     select 3, 'profil', e->>'profil', o->>'profil', e->>'profil' is not null and e->>'profil' = o->>'profil'
--     union all
--     select 3 + i, 'lignes visibles : ' || k, e->k->>'n', o->k->>'n', (e->>k) = (o->>k)
--     from unnest(array['campaigns', 'audiences', 'videos', 'appointment_breakdowns',
--                       'campaign_daily_stats', 'appointments']) with ordinality as t(k, i)
--     union all
--     select 9 + i, 'accès sensible : ' || k, e->>k, o->>k, (e->>k) = (o->>k)
--     from unnest(array['campagnes d''autres clients', 'RDV d''autres clients',
--                       'campagnes non publiées', 'RDV sans campagne']) with ordinality as t(k, i)
--     union all
--     select 14, 'accès autorisé : au moins une campagne visible', '> 0', o->'campaigns'->>'n',
--            coalesce((o->'campaigns'->>'n')::int > 0, false)
--   )
--   select json_agg(x order by x.n) into r
--   from (select n, controle, attendu, observe, coalesce(ok, false) as ok from checks
--         union all
--         select 99, 'BILAN', 'true', bool_and(coalesce(ok, false))::text, bool_and(coalesce(ok, false)) from checks) x;
--   if exists (select 1 from pg_prepared_statements where name = 'sec10_report') then
--     execute 'deallocate sec10_report';
--   end if;
--   execute format('prepare sec10_report as select controle, attendu, observe, ok
--                   from json_to_recordset(%L::json) as t(n int, controle text, attendu text, observe text, ok boolean)
--                   order by n', r);
-- end
-- $sec10_report$;
-- rollback;
-- execute sec10_report;
--
-- Après lecture (facultatif) : deallocate sec10_report;
-- ============================================================================
