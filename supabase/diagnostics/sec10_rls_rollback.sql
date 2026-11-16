-- ============================================================================
-- SEC-10 — RETOUR ARRIÈRE de 20261116000000_rls_published_campaigns.sql.
--
-- Restaure EXACTEMENT les six politiques *_select_own d'origine (rôle
-- {public}, filtre client_id seul, RDV sans campagne visibles), telles que
-- définies dans :
--   - 20260730000000_initial_schema.sql (campaigns, audiences, videos,
--     appointment_breakdowns) ;
--   - 20260801000000_appointments.sql (appointments) ;
--   - 20260802000000_campaign_daily_stats.sql (campaign_daily_stats).
--
-- ATTENTION : rétablit l'exposition des campagnes non publiées via l'API
-- Data (état antérieur à SEC-10). À n'utiliser qu'en cas de régression.
--
-- Ne touche ni aux données, ni aux politiques *_admin_all, ni aux GRANT, ni
-- aux fonctions. Un seul bloc DO : atomique.
--
-- Préconditions bloquantes : exactement les 12 politiques attendues, les six
-- *_select_own STRICTEMENT identiques aux définitions SEC-10 (commande,
-- permissivité, rôle {authenticated}, USING, absence de WITH CHECK) et les six
-- *_admin_all identiques à l'origine. Comparaison exacte après normalisation
-- PostgreSQL via une politique sonde temporaire (sec10_probe) créée puis
-- supprimée dans la même transaction (voir la migration). Toute divergence
-- interrompt le script sans modification.
--
-- Placé dans supabase/diagnostics/ (et non migrations/) : jamais exécuté
-- automatiquement par la CLI. Exécution : éditeur SQL Supabase, tout le
-- fichier d'un coup.
-- ============================================================================

do $sec10_rollback$
declare
  c_admin constant text := $e$public.current_user_role() = 'admin'$e$;
  r       record;
  v_pol   record;
  v_exp   record;
  v_extra text;
begin
  perform set_config('lock_timeout', '5s', true);

  -- Spécification identique à celle de la migration (old = origine, new = SEC-10).
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

  -- ── Préconditions : état EXACT laissé par la migration SEC-10 ──────────

  select string_agg(format('%s.%s', tablename, policyname), ', ' order by tablename, policyname)
    into v_extra
  from pg_policies
  where schemaname = 'public'
    and tablename in (select tbl from sec10_spec)
    and policyname not in (tablename || '_admin_all', tablename || '_select_own');
  if v_extra is not null then
    raise exception 'SEC-10 rollback précondition : politiques inattendues : %', v_extra;
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename in (select tbl from sec10_spec)) <> 12 then
    raise exception 'SEC-10 rollback précondition : les 12 politiques attendues ne sont pas toutes présentes';
  end if;

  for r in select * from sec10_spec order by tbl loop
    -- *_admin_all : inchangée depuis l'origine.
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
      raise exception 'SEC-10 rollback précondition : %_admin_all diverge (cmd=%, roles=%, using=%, check=%)',
        r.tbl, v_pol.cmd, v_pol.roles, v_pol.qual, v_pol.with_check;
    end if;

    -- *_select_own : définition SEC-10 exacte.
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
      raise exception 'SEC-10 rollback précondition : %_select_own diverge de la définition SEC-10 (déjà restaurée ?) roles=%, using=%',
        r.tbl, v_pol.roles, v_pol.qual;
    end if;
  end loop;

  -- ── Restauration des définitions d'origine ─────────────────────────────

  for r in select * from sec10_spec order by tbl loop
    execute format('alter policy %I on public.%I to public using (%s)',
                   r.tbl || '_select_own', r.tbl, r.old_using);
  end loop;

  -- ── Postconditions ─────────────────────────────────────────────────────

  for r in select * from sec10_spec order by tbl loop
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
      raise exception 'SEC-10 rollback postcondition : %_select_own non restaurée', r.tbl;
    end if;
  end loop;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename in (select tbl from sec10_spec)) <> 12 then
    raise exception 'SEC-10 rollback postcondition : nombre de politiques différent de 12';
  end if;

  drop table sec10_spec;
  raise notice 'SEC-10 rollback : 6 politiques *_select_own restaurées à leur définition d''origine.';
end
$sec10_rollback$;

-- Si la migration avait été appliquée via la CLI (supabase db push), marquer
-- ensuite la version comme annulée pour garder l'historique cohérent :
--   npx supabase migration repair --status reverted 20261116000000
-- (puis retirer ou renommer le fichier de migration avant tout nouveau push).
