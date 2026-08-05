# Brief projet — Dashboard de suivi des campagnes (Amerys)

> À lire en entier avant d'agir. Ce fichier donne le contexte complet du projet
> et l'état d'avancement. **Phase 0 et Phase 1 (fondations) réalisées.** Voir
> section 5 pour le détail. Prochaine étape : Phase 2 (synchro Meta/Calendly).

---

## 1. Ce qu'on construit

Une petite application web (qui remplacera un fichier Excel) pour présenter à un
client les résultats de ses campagnes publicitaires Meta. Trois écrans :

- **Vue d'ensemble** : cumuls (dépensé, rendez-vous, coût moyen), un graphe
  combiné rendez-vous (barres) + montant dépensé (courbe) par campagne, avec
  bascule *totaux / par jour*, un sélecteur de période, et la liste des campagnes.
- **Détail d'une campagne** : budget, rendez-vous, leads, coût par rendez-vous,
  durée ; comparaison **Barbier vs Coiffeur** (les 2 audiences) ; répartition des
  rendez-vous par plateforme et par tranche d'âge ; les vidéos avec accroche /
  rétention / vues.
- **Comparaison** : campagnes côte à côte (ramenées « par jour » pour comparer à
  durée égale) et classement des vidéos par coût/lead et par taux d'accroche.

Deux rôles : **admin** (moi, voit tout + l'écart de tracking) et **client**
(lecture seule, voit tout sauf les indicateurs techniques). Pensé **multi-clients**
dès le départ, même s'il n'y a qu'un client aujourd'hui.

La maquette visuelle est déjà validée (design + contenu). On la codera en phase 3.

---

## 2. Correspondance avec la structure Meta (essentiel)

Sur Meta, le client a **une seule campagne maître** (« CAMPAGNE | Formation
Barbier | Conversion Lead ») qui contient **tous les ad sets**. Les ad sets et
les pubs sont préfixés d'un **numéro** (18, 19, 20…) toujours incrémenté et unique.

- **Une « campagne » du dashboard = les ad sets qui partagent le même numéro.**
  Il y en a **toujours 2** : une audience *Barbier* + une audience *Coiffeur*.
- **1 vidéo par ad set** → 2 vidéos par campagne.
- Le **numéro préfixe** est la clé de regroupement. Les campagnes ne tournent
  jamais en même temps (une fenêtre de dates chacune).

## 3. Sources de données

- **API Meta Marketing** (lecture seule) : dépensé, leads pixel, stats vidéo
  (vues, accroche, rétention), répartition âge / plateforme. Lues au niveau
  **ad set** (agrégées par numéro) et **pub** (vidéos).
- **API Calendly** (accès validé, pas encore branché à la synchro) : nombre
  réel de rendez-vous. **Source de vérité** pour les rendez-vous. Le formulaire
  ne contient **pas** un sélecteur binaire Instagram/Facebook comme supposé
  initialement, mais une question ouverte de **canal d'acquisition** (« Par
  quel canal avez-vous découvert notre offre ? ») — valeurs observées sur
  l'échantillon testé : **Instagram, TikTok, Google**. À traiter comme un
  champ texte libre (`acquisition_channel`), pas comme une énumération figée.
- **Saisie manuelle admin** : leads d'autres canaux + corrections éventuelles.

## 4. Règles de calcul clés

- **Un « lead » = un rendez-vous confirmé** (page de confirmation atteinte),
  suivi côté Meta par la conversion perso « Lead - Confirmation de RDV by
  Amerys Agency ».
- **Coût par lead réel = montant dépensé Meta ÷ rendez-vous Calendly** (PAS le
  coût par résultat affiché par Meta).
- Calendly ne distingue pas barbier / coiffeur → le coût/lead **par audience**
  reste basé sur le pixel Meta ; le rendez-vous Calendly reste au niveau campagne.
- Synchro **déclenchée manuellement** par l'admin (pas de temps réel / webhooks).

---

## 5. Où on en est

**Phase 0 — accès Meta : terminée.**
- Accès en lecture à l'API Meta confirmé (`meta-test.mjs`).
- Campagne maître identifiée : `120240751682600030`
  (« CAMPAGNE | Formation Barbier | Conversion Lead by AH »).
- Regroupement par numéro validé : le préfixe `20` isole exactement 2 ad sets
  (Barbier + Coiffeur), conforme à la règle métier.
- Stats vidéo (impressions, plays, thruplays, rétention) disponibles au niveau pub.
- `LEAD_ACTION_TYPE` **confirmé** : `offsite_conversion.custom.4312192355693474`,
  vérifié par correspondance exacte de nom sur les conversions personnalisées
  du compte Meta (« Lead - Confirmation de RDV by Amerys Agency »). Figé dans
  `.env` et requis par `scripts/test-meta-sync.ts` (erreur explicite si absent).

**Phase 1 — Fondations : réalisée**, sous réserve des tests effectivement
réussis en local (lint/build OK au moment de la rédaction ; à revalider si le
code a changé depuis) :
- Projet Next.js (App Router, TypeScript, ESLint) initialisé dans ce dossier.
- Helpers Supabase (navigateur / serveur / admin) et middleware de session.
- Schéma SQL initial + RLS multi-clients dans `supabase/migrations/`.
- Auth email/mot de passe minimale (`/login`, `/dashboard` protégé).
- Aucune mise en ligne effectuée : le projet reste local (pas de Vercel, pas de
  déploiement Supabase). La mise en ligne reste prévue en **Phase 4**.

**Phase 2 — Synchro : en cours.**
- `lib/sync/` : lecture Meta (`meta.ts`), regroupement par numéro
  (`groupByCampaign.ts`), mapping vers les lignes Supabase (`mapper.ts`),
  orchestrateur `syncCampaign(params)` (`syncCampaign.ts`) qui upserte
  Campagne → Audiences → Vidéos de façon idempotente (clés externes stables :
  `client_id`+`campaign_number`, `meta_adset_id`, `meta_ad_id`).
- Testé en conditions réelles côté Meta uniquement (`scripts/test-meta-sync.ts`,
  campagne n°20 : 2 audiences, 2 pubs, stats vidéo exploitables).
- Projet Supabase configuré : migration appliquée (`supabase db push --linked`),
  seed exécuté (client `formation-barbier` créé, une seule ligne, id stable),
  `.env` renseigné (URL racine, clés anon/service role).
- **Bloquant découvert lors du test de connexion lecture seule**
  (`scripts/test-supabase-read.ts`) : `permission denied for table clients`.
  Cause identifiée — la migration initiale n'accorde aucun `GRANT` explicite
  aux rôles `anon`/`authenticated`/`service_role` sur les 7 tables ; seul le
  rôle `postgres` a les privilèges SELECT/INSERT/UPDATE/DELETE. Le projet
  Supabase ne les expose pas automatiquement (comportement par défaut actuel,
  cf. `auto_expose_new_tables` dans `supabase/config.toml`). **Toutes les
  tables sont donc inaccessibles via l'API Data (et `syncCampaign`) tant
  qu'une migration corrective n'ajoute pas les `GRANT` nécessaires** — non
  fait ici (hors périmètre : « ne pas toucher migrations/schéma »).
- Calendly toujours non branché à la synchro : `calendly_appointments` et
  `manual_appointments_adjustment` restent à 0 (défaut DB) tant qu'elle
  n'existe pas ; `syncCampaign` ne les écrase jamais.
- **Accès Calendly validé** (`scripts/test-calendly.ts`, lecture seule) :
  authentification réussie, 1 type d'événement actif, échantillon de
  rendez-vous confirmés (`status=active`) récupéré. Écart constaté avec ce
  brief : voir ci-dessus (canal d'acquisition ouvert, pas Instagram/Facebook
  binaire). Aucune ventilation Barbier/Coiffeur côté Calendly (confirmé —
  cohérent avec la section 4).
- **Modèle de données étendu** pour les rendez-vous Calendly : migration
  `supabase/migrations/20260801000000_appointments.sql` (table `appointments`,
  idempotente via `calendly_event_uri` unique, cohérence client/campagne
  garantie par FK composite `(campaign_id, client_id) -> campaigns(id, client_id)`,
  RLS admin/CRUD + client/lecture seule). **Appliquée** au projet Supabase
  distant (constaté lors du branchement de la synchro ci-dessous ;
  `supabase migration list --linked` la montre à jour, table/colonnes/policies/
  grants vérifiés conformes à la migration).
- **Synchro Calendly -> `appointments` codée et testée en conditions réelles,
  réellement différentielle** (`lib/calendly/client.ts`,
  `lib/calendly/appointments.ts` : `fetchAppointments()` lecture seule,
  pagination complète, statuts `active`/`canceled` uniquement ;
  `lib/calendly/mapper.ts` ; orchestrateur `lib/sync/syncAppointments.ts`).
  Chaque rendez-vous est comparé au préalable à la ligne existante
  (`event_type_uri`, `start_time`, `status`, `acquisition_channel`,
  `campaign_id`) ; seuls les créations/changements réels sont upsertés (par
  lots de 50), un rendez-vous identique n'est pas réécrit. `acquisition_channel`
  rempli via la question de formulaire confirmée en Phase 0 (configurable via
  `CALENDLY_ACQUISITION_CHANNEL_QUESTION`).
- **Rattachement automatique `campaign_id` par fenêtre de dates, fuseau
  Europe/Paris** (`lib/calculations.ts`, `campaignsMatchingAppointment` :
  fonction pure, testée isolément) : un rendez-vous est rattaché à la
  campagne du même client dont `start_date` 00:00:00 – `end_date` 23:59:59,
  interprétées en **heure locale Europe/Paris** (pas UTC — le client et ses
  rendez-vous Calendly sont en France ; une conversion naïve en UTC décale
  les bornes de 1h/2h selon la saison), contient son `start_time`. Décalage
  CET/CEST calculé via `Intl.DateTimeFormat` (aucune dépendance ajoutée),
  correct de part et d'autre des changements d'heure (00:00:00/23:59:59 ne
  tombent jamais dans l'heure ambiguë du changement). Campagnes sans
  `start_date`/`end_date` ignorées. Aucune fenêtre correspondante →
  `campaign_id = null`. Plusieurs fenêtres chevauchantes → erreur explicite
  journalisée, aucune attribution arbitraire (valeur existante préservée,
  `null` pour une création). Aucune ventilation Barbier/Coiffeur.
  Testé avec `scripts/test-sync-appointments.ts` : tests unitaires purs
  (fenêtre, hors fenêtre, chevauchement, bornes hiver/été/changements
  d'heure 2026-03-29 et 2026-10-25) puis **tests en conditions réelles avec
  restauration** — fenêtre réelle temporaire sur la campagne n°19
  (2026-06-30 → 2026-07-17, Europe/Paris) : 60 rendez-vous réellement
  rattachés, vérifiés en base, puis `end_date` restaurée à `null` et
  `campaign_id` revenu à `null` sur ces 60 lignes via la synchro elle-même
  (pas d'UPDATE manuel) ; chevauchement réel temporaire entre les
  campagnes n°19 et n°20 (zone 2026-07-18 → 2026-07-20) : 4 rendez-vous
  réels dans la zone, 0 attribué, 4 erreurs explicites journalisées, les 60
  rendez-vous hors recouvrement restent correctement rattachés ; puis
  restauration complète (les deux `end_date` remis à `null`, vérifié
  indépendamment en base) et rejeu sans changement (0 création, 0 mise à
  jour, 1145 ignorés). Base finale strictement identique à l'état initial
  (1145 rendez-vous, 0 `campaign_id` non nul). Aucune donnée personnelle
  lue ni stockée (nom/email/téléphone/réponses libres).
- **Correctif du champ utilisé pour le rattachement (campagne n°20) : le
  rattachement d'un rendez-vous à une campagne utilise la date de création
  de la réservation Calendly, pas la date prévue du rendez-vous.** La
  fenêtre décrite au point précédent (`start_date`/`end_date`, Europe/Paris,
  chevauchement = erreur explicite) est inchangée ; seul l'instant comparé à
  cette fenêtre change. AVANT : `campaign.start_date <= appointment.start_time
  <= campaign.end_date`. APRÈS : `campaign.start_date <=
  appointment.booking_created_at <= campaign.end_date`, où
  `booking_created_at` est `invitee.created_at` côté API Calendly (champ
  prouvé, pas supposé, sur 3 cas réels de la campagne n°20 : réservations
  Instagram créées le 29, 30 et 31/07 — donc pendant la fenêtre de la
  campagne n°20 — pour des créneaux planifiés après sa fin le 01/08).
  `start_time` reste stockée et affichée pour l'information opérationnelle
  du rendez-vous (quand il aura lieu), mais n'est plus jamais utilisée pour
  ce rattachement. Colonne `booking_created_at` (`timestamptz`, nullable)
  ajoutée par la migration `20260806000000_appointments_booking_created_at.sql`
  (`types/database.ts`, `lib/calendly/appointments.ts`,
  `lib/sync/syncAppointments.ts`, `lib/sync/syncCalendlyDailyStats.ts` — cette
  dernière calcule désormais `stat_date` à partir de
  `booking_created_at`, pas `start_time`). Sans `booking_created_at` (rendez-
  vous pas encore enrichi), aucun rattachement n'est tenté — jamais de repli
  sur `start_time`. Campagnes `sync_locked` (n°1 à 19) non concernées : leurs
  rendez-vous déjà rattachés ne sont jamais reconsidérés, quel que soit le
  champ de comparaison.
- **Dashboard branché sur les RDV Calendly réels** (`app/dashboard/page.tsx`,
  `OverviewSection.tsx`, `campaigns/[id]/page.tsx`). RDV comptés directement
  dans `appointments` (`status='active'`, `campaign_id` rattaché) — jamais
  depuis `campaigns.calendly_appointments`, resté à 0 (jamais écrit par la
  synchro). Vue d'ensemble : « Total leads Meta » remplacé par « Total
  rendez-vous » (RDV réels = RDV Calendly + `manual_appointments_adjustment`,
  sommés sur les campagnes du client), coût moyen recalculé sur dépensé ÷ RDV
  Calendly (leads Meta gardés en note secondaire sous le total). Liste des
  campagnes : colonnes RDV Calendly / coût réel par RDV (mode Par jour :
  RDV/jour, via `appointmentsPerDay` déjà existante). Détail campagne :
  ajout RDV confirmés + coût réel/RDV, écart de tracking (RDV réels − leads
  Meta) visible **admin uniquement** (`isAdmin`, cohérent avec le reste du
  dashboard) ; cartes Barbier/Coiffeur inchangées (coût/lead pixel Meta,
  aucune ventilation Calendly par audience — Calendly ne la fournit pas).
  Zéro RDV → `—` (jamais `Infinity`/`NaN`, `realCostPerAppointment` retourne
  déjà `null` dans ce cas). Aucune fonction ajoutée à `lib/calculations.ts` :
  `realAppointments`, `realCostPerAppointment`, `trackingGap`,
  `appointmentsPerDay` existaient déjà (construites par anticipation lors
  des fondations), seul leur branchement dans les pages était manquant.
  Validé en conditions réelles (serveur local, sessions admin/client
  temporaires) avec la même fenêtre témoin que ci-dessus (campagne n°19,
  49 RDV réels au moment du test — le nombre évolue avec Calendly) : totaux
  et coût réel corrects sur la vue d'ensemble (admin et client), RDV
  confirmés + coût réel corrects sur le détail (admin et client), écart de
  tracking affiché pour l'admin et confirmé **absent** du HTML pour le
  client, puis restauration complète (`end_date` et `campaign_id` revenus à
  l'état initial, vérifié indépendamment en base).
- **Répartition des RDV par canal d'acquisition** dans le détail campagne
  (`app/dashboard/campaigns/[id]/page.tsx`, `groupByAcquisitionChannel` —
  fonction locale au fichier, pas ajoutée à `lib/calculations.ts`, non
  listée dans le périmètre de cette tâche). Regroupe les rendez-vous
  `status='active'` de la campagne par `acquisition_channel`, normalisé pour
  le seul regroupement (`trim()` + comparaison insensible à la casse),
  jamais pour l'affichage : l'étiquette montrée reste la première valeur
  réelle rencontrée pour ce canal, telle quelle (ex. « Tiktok » observé tel
  quel côté Calendly, pas reformaté en « TikTok »). `null`/vide -> « Non
  renseigné ». Trié par nombre décroissant ; pourcentage via `formatPct`
  déjà existante. Section visible admin **et** client (pas de `isAdmin`,
  contrairement à l'écart de tracking). État vide propre si aucun rendez-vous.
  Une seule requête Supabase sert à la fois le total RDV (KPI) et la
  répartition (avant : requête `count`-only séparée, supprimée). Validé en
  conditions réelles (même fenêtre témoin, campagne n°19) contre une
  référence de regroupement indépendante calculée directement en base :
  Google 17 (34,7 %), Facebook 15 (30,6 %), Instagram 12 (24,5 %), Tiktok 4
  (8,2 %), MCB 1 (2,0 %) — somme des canaux = 49 = total RDV Calendly de la
  campagne. Rendu HTML confirmé strictement identique (comparaison directe
  de la sortie serveur, pas juste masqué en CSS) entre session admin et
  session client. Restauration complète revérifiée après ce test.
- **Vue Comparaison branchée sur les RDV Calendly réels**
  (`app/dashboard/comparison/page.tsx`). RDV comptés par campagne comme
  ailleurs dans le dashboard (`appointments`, `status='active'`,
  `campaign_id` rattaché + `client_id` revérifié — jamais
  `campaigns.calendly_appointments`). Tableau : RDV Calendly, RDV/jour
  (`appointmentsPerDay`, si durée disponible), dépensé, coût réel/RDV ;
  leads Meta gardés en dernière colonne, information secondaire (couleur
  atténuée). Mise en avant (« top ») sur le meilleur RDV/jour (max) et le
  meilleur coût réel/RDV (min) uniquement — jamais sur des totaux bruts non
  comparables, même principe que l'existant. `lib/calculations.ts` inchangé
  (mêmes fonctions déjà existantes que le reste du dashboard). Classement
  vidéo (`VideoRanking.tsx`) **non modifié** : toujours coût/lead pixel Meta
  + taux d'accroche, aucune ventilation RDV. Validé en conditions réelles
  (fenêtre témoin campagne n°19, 49 RDV réels) : ligne campagne 19 exacte
  (18 j, 49 RDV, 2,72 RDV/j, 500 €, 10,20 €, badges « top » sur RDV/j et
  coût réel/RDV — seule campagne avec des RDV réels), campagne 20 (aucune
  fenêtre) affiche `—`/0 sans classement ni badge erroné, classement vidéo
  confirmé inchangé. **Isolation multi-client vérifiée** avec un second
  client/campagne/rendez-vous temporaires et non liés (créés puis supprimés
  pour le test) : aucune trace de ces données dans le rendu du client réel.
  Restauration complète revérifiée après ce test.
- **Filtre de période global reporté.** Une première version (préréglages
  Aujourd'hui/7 derniers jours/30 derniers jours/Ce mois/Personnalisé,
  composant `DashboardDateFilter` partagé via l'URL) a été implémentée puis
  entièrement retirée : elle comptait une campagne avec la totalité de ses
  données historiques (dépensé, RDV...) dès que sa fenêtre `start_date`–
  `end_date` chevauchait la période choisie, faute de granularité
  journalière — comportement métier incorrect, pas seulement un défaut
  d'affichage. Le filtre sera réimplémenté une fois une synchro quotidienne
  Meta/Calendly branchée sur `campaign_daily_stats` (ci-dessous).
- **Table `campaign_daily_stats` créée puis appliquée**
  (`supabase/migrations/20260802000000_campaign_daily_stats.sql`) :
  statistiques Meta/Calendly par jour et par campagne (`meta_spend`,
  `meta_pixel_leads`, `calendly_appointments`), contrainte unique
  `(campaign_id, stat_date)` pour l'idempotence de la synchro quotidienne,
  cohérence client/campagne garantie par la même clé étrangère composite
  `(campaign_id, client_id) -> campaigns(id, client_id)` que `appointments`,
  RLS admin CRUD / client lecture seule. `types/database.ts` mis à jour.
- **Synchro Meta quotidienne codée et testée en conditions réelles**
  (`lib/sync/meta.ts` : `fetchAdSetDailyInsights`, `time_increment=1` ;
  `lib/sync/mapper.ts` : `aggregateDailyInsights`, agrège barbier+coiffeur par
  date, aucun jour synthétique — seules les dates réellement retournées par
  Meta sont upsertées ; `lib/sync/syncCampaignDailyStats.ts` : une campagne,
  cherche la ligne `campaigns` déjà existante par `client_id`+
  `campaign_number` (ne la recrée jamais) ; `lib/sync/syncAllCampaignsDailyStats.ts` :
  boucle strictement séquentielle sur les campagnes valides détectées, arrêt
  immédiat si Meta renvoie le code 17 — limite de débit — traité comme un
  arrêt normal, pas une erreur). `meta_spend`/`meta_pixel_leads` sont les
  seuls champs écrits ; `calendly_appointments` toujours omis du payload
  d'upsert, donc jamais écrasé (vérifié avec une valeur sentinelle posée
  manuellement, qui survit à un rejeu). Validé en conditions réelles
  (`scripts/test-sync-campaign-daily-stats.ts`) : campagne témoin n°20 — 8
  jours upsertés, somme journalière du dépensé et des leads strictement
  égale au total campagne (298,03 € / 9 leads des deux côtés), second run
  sans doublon (mêmes ids). Puis les 9 campagnes valides (12 à 20) : premier
  passage 9/9 réussies (125 lignes au total) ; second passage a réellement
  atteint la limite de débit Meta (code 17) après 7 campagnes et s'est arrêté
  immédiatement comme prévu, sans tenter les suivantes — confirmation en
  conditions réelles, pas seulement en théorie. Aucune UI ne lit encore cette
  table.
- **Synchro Calendly quotidienne codée et testée en conditions réelles**
  (`lib/calculations.ts` : `parisDateFromInstant`, direction inverse de
  `parisDateToUtcMs`, même fuseau Europe/Paris ; `lib/sync/syncCalendlyDailyStats.ts` :
  agrège les rendez-vous déjà synchronisés — `appointments.status='active'`,
  `campaign_id` non nul, aucun appel Calendly direct, aucune donnée
  personnelle lue — par `(campaign_id, stat_date)`). Contrairement à la
  synchro Meta (qui n'insère que les jours retournés par l'API), celle-ci
  remet aussi à 0 les jours déjà en base qui n'ont plus de rendez-vous actif
  (rendez-vous annulé ou détaché depuis) : le jeu de lignes upsertées est
  l'union des jours réellement comptés et des jours déjà existants pour le
  client. `calendly_appointments` est le seul champ écrit ; `meta_spend`/
  `meta_pixel_leads` toujours omis du payload, jamais écrasés. Validé en
  conditions réelles (`scripts/test-sync-calendly-daily-stats.ts`, fenêtre
  témoin campagne n°19, 2026-06-30 → 2026-07-17, même fenêtre que
  `test-sync-appointments.ts`) : 49 rendez-vous réellement rattachés, somme
  journalière Calendly = 49 (égalité stricte), colonnes Meta des 13 jours
  déjà existants strictement inchangées, second run idempotent (mêmes ids,
  mêmes valeurs), puis restauration complète (rendez-vous détachés via
  `syncAppointments()`, compteurs journaliers remis à 0 par
  `syncCalendlyDailyStats()` elle-même — jamais de DELETE/UPDATE manuel).
  Avec `campaign_daily_stats` désormais alimentée des deux côtés (Meta et
  Calendly), le filtre de période a pu être réimplémenté sur cette base
  (voir point suivant).
- **Filtre global de période réimplémenté sur `campaign_daily_stats`
  (corrige la version précédente, retirée pour incorrection métier — voir
  historique)** : filtre partagé Aujourd'hui / 7 derniers jours / 30
  derniers jours / Ce mois / Personnalisé (`lib/calculations.ts` :
  `resolveDateRange`, `enumerateDateRange`, fuseau Europe/Paris via
  `parisDateFromInstant`), persisté dans la query string (`?period=&from=&to=`,
  `lib/dateRangeQuery.ts`) et conservé entre Vue d'ensemble, Détail campagne
  et Comparaison (`Sidebar.tsx` propage `useSearchParams().toString()` sur
  ses liens). Tous les totaux affichés en mode période sont des sommes
  exactes de `campaign_daily_stats` filtrées par `stat_date` (comparaison de
  chaînes `YYYY-MM-DD`, aucune conversion UTC nécessaire) : Vue d'ensemble
  (dépensé, RDV, coût/RDV réel, graphique par jour zero-filled via
  `OverviewDailyChart.tsx`, tableau campagnes agrégé sur la période) ;
  Détail campagne (mêmes KPI limités à la période ; les métriques
  audience/vidéo Meta sans granularité journalière restent affichées en
  totaux campagne entière, explicitement libellées « (total campagne) ») ;
  Comparaison (RDV, RDV/jour — dénominateur = durée de la période, uniforme
  pour toutes les campagnes —, dépensé, coût/RDV réel ; classement vidéos
  explicitement libellé « toutes périodes confondues »). Aucune estimation
  depuis les totaux campagnes : `manual_appointments_adjustment` (correctif
  manuel sans date) n'est jamais appliqué à une somme de période, faute de
  moyen non arbitraire de l'attribuer à un jour précis. État vide honnête
  (`EmptyPeriodState.tsx`, aucune grille KPI) si aucune ligne journalière
  dans la période. `OverviewSection.tsx`/`OverviewChart.tsx` (mode sans
  filtre) restent inchangés à l'octet près. Aucun changement de schéma,
  sync, API ou RLS. Validé en conditions réelles sans capture d'écran
  (requêtes `fetch()` authentifiées, comparaison texte sur le HTML rendu) :
  fenêtre témoin campagne n°19, 2026-06-30 → 2026-07-17 — Dépensé=500 €,
  RDV=49, sommes identiques et exactes sur Vue d'ensemble et Détail
  campagne ; libellés « (total campagne) » et « toutes périodes confondues »
  présents ; lien Comparaison de la Sidebar conserve le filtre ;
  `?period=today` (aucune donnée) affiche l'état vide sans grille KPI ;
  restauration complète des données de test confirmée.
- **Bouton admin « Synchroniser » chaîné : totaux Meta puis quotidien Meta,
  en un seul clic** (`app/api/admin/sync/route.ts`) : `syncAllCampaigns`
  (totaux campagnes/audiences/vidéos) est `await`é en premier ; seulement
  s'il se termine (succès ou échecs par campagne déjà journalisés
  individuellement) `syncAllCampaignsDailyStats` est lancé ensuite — jamais
  en parallèle, jamais si `syncAllCampaigns` lève une exception (dans ce cas
  la réponse est un échec explicite unique et le quotidien n'est pas
  tenté). La réponse JSON expose deux rapports strictement séparés,
  `totals` et `daily` (compteurs détectées/succès/échecs/invalides propres à
  chacun, plus `daysUpserted` et `stoppedOnRateLimit` côté `daily`) ; si le
  volet quotidien échoue de façon inattendue après des totaux déjà réussis,
  la réponse renvoie `{ totals, daily: { error } }` — les totaux acquis ne
  sont jamais perdus ni l'échec masqué. `SyncMetaButton.tsx` affiche un
  résumé court des deux étapes (deux lignes : totaux puis quotidien, avec le
  nombre de jours mis à jour et une mention explicite si la limite Meta a
  été atteinte). Aucun changement Calendly, schéma, migration ou calcul ;
  toujours lecture seule côté Meta. Validé par un clic réel unique
  (`fetch()` authentifié, un seul `POST`) : 9 campagnes détectées, 9/9
  synchronisées côté totaux, volet quotidien ayant réellement atteint la
  limite de débit Meta (code 17) après 1 campagne — comportement observé en
  conditions réelles, pas simulé : `succeeded=1`, `failed=1`,
  `stoppedOnRateLimit=true`, totaux intacts, échec partiel renvoyé
  explicitement sans être masqué ; 15 lignes `campaign_daily_stats`
  fraîchement écrites par ce même appel (filtre de période nourri) ; 9
  nouvelles lignes `sync_runs` (exactement une par campagne totaux, aucune
  double exécution).
- **Bouton admin « Synchroniser Calendly » chaîné : rendez-vous puis
  quotidien Calendly, en un seul clic** (`app/api/admin/sync/calendly/route.ts`) :
  `syncAppointments` est `await`é en premier ; seulement s'il se termine
  sans lever d'exception, `syncCalendlyDailyStats` est lancé ensuite —
  jamais en parallèle. Si `syncAppointments` échoue, la réponse est un échec
  explicite unique (`{ error }`, statut 500) et le quotidien n'est jamais
  tenté. La réponse JSON expose deux rapports strictement séparés :
  `appointments` (lus/créés/mis à jour/ignorés/erreurs, mapping inchangé de
  `syncAppointments`) et `daily` (`campaignsProcessed`, `daysUpserted`,
  `daysWithAppointments`, `daysZeroed`, `errors`) ; `campaignsProcessed` est
  un nouveau champ ajouté à `SyncCalendlyDailyStatsResult`
  (`lib/sync/syncCalendlyDailyStats.ts`, simple comptage de
  `campaign_id` distincts parmi les lignes déjà calculées — aucun changement
  de calcul, seulement une donnée de rapport supplémentaire). Si le volet
  quotidien échoue après des rendez-vous déjà synchronisés avec succès, la
  réponse renvoie `{ appointments, daily: { error } }` — les rendez-vous
  acquis ne sont jamais perdus ni l'échec masqué. `SyncCalendlyButton.tsx`
  affiche un résumé court des deux étapes (deux lignes : rendez-vous puis
  quotidien, avec le nombre de jours mis à jour et de campagnes traitées).
  Aucun changement Meta, schéma, migration, RLS ni donnée personnelle
  exposée (toujours campaign_id/start_time uniquement côté quotidien).
  Validé par un clic réel unique (`fetch()` authentifié, un seul `POST`,
  ~285 s du fait du volume réel de rendez-vous) : 1146 rendez-vous lus, 0
  créé/mis à jour (déjà synchronisés, upsert différentiel inchangé), 0
  erreur ; volet quotidien réussi juste après : 9 campagnes traitées, 130
  jours upsertés (tous remis à 0, aucun rendez-vous actuellement rattaché à
  une fenêtre de campagne — état production réel, cohérent avec les
  restaurations de tests précédentes) ; 130 lignes `campaign_daily_stats`
  fraîchement mises à jour par ce même appel (filtre de période nourri) ;
  aucune ligne fraîche avant l'appel (0 → 130), confirmant l'absence de
  double exécution.
- **Administration minimale des utilisateurs (`/dashboard/admin/users`,
  admin uniquement)** : liste les comptes existants (e-mail, rôle, client
  associé) et un formulaire de création (e-mail, mot de passe temporaire,
  rôle `admin`/`client`, client existant obligatoire). Garde à trois
  niveaux : `page.tsx` redirige vers `/login` (anonyme) ou `/dashboard`
  (rôle ≠ admin) ; la Server Action `createUser`
  (`app/dashboard/admin/users/actions.ts`) revérifie le rôle admin
  côté serveur indépendamment de l'affichage (une Server Action est un point
  d'entrée public au même titre qu'une route API) ; `Sidebar.tsx` n'affiche
  le lien « Utilisateurs » que si `isAdmin` (nouvelle prop, propagée depuis
  `layout.tsx`). Lecture de la liste et création passent exclusivement par
  `createAdminClient()` (service_role, `lib/supabase/admin.ts` non modifié) :
  c'est le seul moyen de lire les e-mails (`auth.admin.listUsers()`, aucune
  colonne email dans `profiles` — aucun nouveau schéma). Séquence de
  création : vérifie l'existence du `clientId` (évite de créer un compte
  Auth pour un client invalide) → `auth.admin.createUser()` → insertion
  `profiles`. **Anti-compte-orphelin** : si l'insertion du profil échoue
  après la création du compte Auth, celui-ci est immédiatement supprimé
  (`auth.admin.deleteUser()`) et l'échec est renvoyé explicitement. Pas de
  suppression/modification de compte dans cet incrément. Validé en
  conditions réelles (comptes de test jetables, supprimés après coup) :
  accès anonyme → redirigé `/login` ; accès client → redirigé `/dashboard`
  (jamais la page admin) ; accès admin → 200 avec liste correcte (e-mails
  des deux comptes de test présents) ; lien Sidebar présent pour l'admin,
  absent pour le client ; création réussie avec `client_id`/`role` corrects
  en base ; rollback anti-orphelin déclenché par une vraie violation de
  contrainte FK (`client_id` inexistant) — compte Auth et profil tous deux
  absents après coup, confirmé indépendamment.
- **`/` redirige vers `/login`, `/login` refait visuellement** (thème du
  dashboard réutilisé — palette/rayons/ombres de `app/dashboard/format.ts`),
  sans changement de logique d'authentification.
- **Préparation production (MVP terminé, incrément de durcissement, aucun
  changement métier/RLS/schéma/Meta/Calendly)** :
  - **Récupération de mot de passe complète** : `/forgot-password` (envoi
    e-mail Supabase, message générique qu'un compte existe ou non — anti-
    énumération), `app/auth/confirm/route.ts` (échange le lien reçu contre
    une session, callback PKCE), `/update-password` (accessible uniquement
    avec une session active). Composants d'auth mutualisés
    (`app/AuthShell.tsx`, `app/auth-ui.tsx`) entre `/login`,
    `/forgot-password` et `/update-password`. **Correctif critique découvert
    lors de la validation ultérieure** : ce projet Supabase délivre en
    réalité les liens de récupération au format historique (jetons dans le
    *fragment* d'URL, `#access_token=...&type=recovery`, jamais transmis au
    serveur), pas au format `?code=` que `app/auth/confirm/route.ts` gère
    seul — confirmé en générant un vrai lien (`auth.admin.generateLink`) et
    en suivant la redirection réelle. Sans correctif, le parcours ne
    fonctionnait jamais, quelle que soit la configuration de
    `NEXT_PUBLIC_SITE_URL`. Corrigé par `app/login/RecoveryHashHandler.tsx`
    (composant client monté sur `/login`, où le fragment atterrit après le
    double saut de redirection serveur) : lit le fragment, établit la
    session via `auth.setSession()`, redirige vers `/update-password` ; si
    Supabase renvoie une erreur dans le fragment (lien expiré/invalide),
    redirige vers `/login?error=...` avec un message propre au lieu d'échouer
    silencieusement. `app/auth/confirm/route.ts` reste en place (couvre le
    format `?code=` si l'allow-list Supabase est un jour reconfigurée en
    PKCE) — les deux mécanismes coexistent sans conflit.
  - **Session** : `proxy.ts` (middleware Next.js 16) rafraîchissait déjà la
    session et protégeait `/dashboard/*` — confirmé en conditions réelles,
    aucun changement nécessaire (une tentative d'ajouter un `middleware.ts`
    séparé a été détectée en conflit au build et retirée).
  - **Pages système** : `app/not-found.tsx`, `app/error.tsx`,
    `app/global-error.tsx` (jamais de trace technique affichée),
    `app/forbidden/page.tsx` (réutilisable, non branchée sur les gardes
    d'accès existantes qui redirigent déjà silencieusement),
    `app/dashboard/loading.tsx`.
  - **Monitoring léger** : `lib/logger.ts` (`logError`, catégories
    `api`/`sync`/`critical`, stdout/stderr uniquement), branché sur tous les
    `console.error` existants (routes de synchro, pages dashboard,
    `syncCampaign.ts`) et les nouveaux points d'échec (mot de passe,
    administration).
  - **Sécurité** : en-têtes HTTP (`next.config.ts` : `X-Content-Type-Options`,
    `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
    `Strict-Transport-Security`), cookies/validation d'entrées vérifiés
    (déjà conformes, aucun changement requis).
  - **Administration complétée** (`app/dashboard/admin/users/`) :
    suppression de compte, réinitialisation de mot de passe (même mécanisme
    que `/forgot-password`), désactivation/réactivation
    (`auth.admin.updateUserById(ban_duration)`), colonnes « Créé le » et
    « Dernière connexion » — toutes deux déjà fournies par
    `auth.admin.listUsers()`, aucun changement de schéma. Garde anti-auto-
    suppression/désactivation (un admin ne peut pas agir sur son propre
    compte).
  - **UX** : token `redOnDark` (palette) remplaçant une couleur d'erreur en
    dur dupliquée dans les boutons de synchro ; `role="status"`/`role="alert"`
    uniformisés sur tous les messages de formulaire.
  - **Qualité** : suppression du script de test obsolète
    `scripts/test-admin-sync-route.ts` (contrat de route périmé), titre/
    description de page par défaut Next.js remplacés par le nom réel de
    l'app. Aucun `TODO`/`FIXME` trouvé dans le code.
  - **Documentation** : `README.md` réécrit (architecture, variables d'env,
    déploiement, sauvegarde/restauration, commandes utiles) ;
    `.env.example` complété (`LEAD_ACTION_TYPE`, `NEXT_PUBLIC_SITE_URL`).
  - Validé en conditions réelles (comptes de test jetables) : pages système,
    session/redirections, formulaire mot de passe oublié, gestion
    utilisateurs (désactivation/réactivation/`created_at` réels) — lint,
    typecheck et build systématiquement vérifiés après chaque étape.
  - **Hors périmètre / nécessiterait une action manuelle hors code** :
    configurer `NEXT_PUBLIC_SITE_URL` et les *Redirect URLs* Supabase Auth
    en production pour que le lien de réinitialisation fonctionne
    réellement (voir README.md, section Déploiement).
- **Corrections UX/UI suite à la recette du compte client (MAQUETTE-UI.png
  fait foi ; MAQUETTE-UI.png ne couvre que l'écran Vue d'ensemble — aucune
  image de référence pour Détail campagne)** :
  - **Header** : « Dernière synchro Meta »/« Dernière modification Calendly »
    admin uniquement (`isAdmin`) ; chevron trompeur retiré à côté du nom
    client (aucun sélecteur multi-client réel) pour les deux rôles.
  - **KPI Vue d'ensemble** : carte « Campagnes synchronisées »/« Campagnes
    actives » (indicateur technique) retirée, sans remplacement — la
    maquette montre un 4ᵉ KPI « Tracking Meta » à cet emplacement, non
    ajouté : `écart de tracking` est une donnée admin-only déjà établie
    (« client voit tout sauf les indicateurs techniques », section 1) et son
    équivalent en % n'est défini nulle part — l'ajouter aurait exigé
    d'inventer une formule (hors périmètre : aucune nouvelle fonctionnalité).
  - **`OverviewChart.tsx`/`OverviewDailyChart.tsx`** : double axe restauré
    (gauche = Dépensé €, droite = RDV — ordre réel de la maquette, l'énoncé
    de la tâche les inversait), 5 graduations lisibles par axe (pas de
    10/20/50 arrondis, jamais la valeur brute), légende toujours complète
    (avant : masquée si RDV=0), durée ajoutée sous chaque numéro de
    campagne. Indexation par campagne (pas par date) volontairement
    conservée — déjà justifiée dans une tâche antérieure, ce n'est pas la
    logique métier de l'app.
  - **RDV=0 (bug critique signalé) : cause réelle identifiée, aucun code
    fautif.** Les 9 campagnes ont `end_date = null` ; `syncAppointments()`
    exclut par construction toute campagne sans `end_date` du rattachement
    (`campaignsMatchingAppointment`, comportement documenté, pas un bug) :
    aucun rendez-vous ne peut donc recevoir de `campaign_id`, d'où
    `campaign_daily_stats.calendly_appointments = 0` partout, en cascade
    honnête (graphique, canal d'acquisition, KPI). Toute la chaîne
    (`appointments`, `campaign_daily_stats`, sync Calendly, mapping,
    agrégation, filtre période) vérifiée correcte. Décision explicite :
    l'utilisateur saisira lui-même les dates de fin via `EndDateEditor`
    (déjà fonctionnel) plutôt qu'une correction automatique de données de
    production.
  - **Détail campagne — canal d'acquisition** : donnée réelle confirmée
    (`acquisition_channel` peuplé sur 1088 rendez-vous actifs, 9 canaux
    distincts) malgré l'absence de `campaign_id` (même cause que ci-dessus) —
    bloc conservé, transformé en donut + liste (fusionne l'ancien tableau et
    le « bloc plateforme » demandé, qui aurait sinon dupliqué la même
    donnée). Le donut ne montre jamais un Facebook/Instagram binaire
    inventé : les vrais canaux observés (Google, Facebook, Instagram,
    Tiktok, MCB...) sont tous représentés. Une ligne « Ajustement manuel »
    apparaît si `manual_appointments_adjustment ≠ 0` (jamais aujourd'hui)
    pour que le total reste strictement égal au KPI « RDV confirmés ».
  - **Bloc « tranche d'âge » non reconstruit** : `appointment_breakdowns`
    (colonnes `age_18_24`...`age_55_plus`) existe dans le schéma initial
    mais n'est lue ni écrite nulle part dans le code — confirmé par
    recherche exhaustive. Calendly ne collecte aucune donnée d'âge (formulaire
    réel vérifié en Phase 0) : la donnée n'existe pas et ne peut pas être
    inventée. Aucun placeholder ajouté (pas une donnée manquante
    temporaire, une absence permanente de source).
  - **Barbier vs Coiffeur** : bannière vidéo ajoutée (fond sombre, icône
    Play décorative — jamais de lecture vidéo réelle, aucune URL vidéo
    stockée —, badge « X vues » réel, badge « Meilleur coût/lead » sur la
    comparaison réelle entre les deux audiences), nom de la vidéo en
    overlay. Miniature réelle impossible sans modification de schéma
    (aucune colonne d'image vidéo) : hors périmètre, non ajoutée. Toutes les
    métriques métier existantes conservées (Dépensé, Leads Meta, Coût/lead,
    Impressions, Plays, ThruPlays, Accroche play/thruplay, Rétention).
  - Validé en conditions réelles (comptes de test jetables) : header/KPI par
    rôle, graphique sans régression (aucun NaN/Infinity), état vide honnête
    du canal d'acquisition, bannière vidéo + badge meilleur coût/lead
    présents, aucune régression admin (sync, écart de tracking).
- **`videos.video_display_name` : nom métier affiché dans le dashboard pour
  une vidéo** (migration `20260807000000_videos_display_name.sql`, `text
  null`). Distinct de `videos.name` (nom de la PUB tel que saisi dans Ads
  Manager, inchangé) : `video_display_name` est le nom réel du fichier vidéo
  importé dans Meta (node Vidéo, champ `title`). Pour les campagnes
  synchronisées via Meta, il est rempli **automatiquement** par la synchro
  (`lib/sync/syncCampaign.ts`) : `fetchAdSetAds` lit désormais
  `creative{object_story_spec}`, `extractVideoId` (`lib/sync/mapper.ts`)
  n'utilise QUE `creative.object_story_spec.video_data.video_id` — jamais
  `creative.video_id` (racine), qui pointe vers un autre id Meta inaccessible
  avec les permissions de ce token (erreur `#10`, constatée en conditions
  réelles) — puis `fetchVideoTitle` (`lib/sync/meta.ts`) appelle `GET
  /{video_id}?fields=title` en lecture seule, un seul appel par `video_id`
  réellement rencontré durant la synchro (cache en mémoire partagé entre les
  deux audiences barbier/coiffeur de la campagne, voir
  `resolveVideoDisplayName`). Jamais stocké : `source`/`permalink_url`/URL
  CDN/miniature — uniquement `title`. Aucune erreur possible : pas de
  `video_id`, pas de `title`, permission refusée, pub non vidéo →
  `video_display_name = null`, la synchro de la campagne continue
  normalement. Pour les **campagnes historiques n°1 à 11** (ancien compte
  Meta, `sync_locked=true`, jamais resynchronisées — voir
  `campaigns.sync_locked`), `video_display_name` reste `null` : il sera
  renseigné **manuellement** plus tard, le code n'a rien à faire de spécial
  pour ce cas. Affichage (détail campagne et comparaison) selon la priorité
  `video_display_name` → `videos.name` → `"Vidéo"` (jamais d'erreur, jamais
  de placeholder technique) ; le nom de la pub Meta reste visible mais
  secondaire à côté du nom vidéo — **seulement s'il diffère réellement** du
  libellé principal (sinon doublon visuel : quand `video_display_name` est
  `null`, le libellé principal retombe déjà sur `videos.name`, les deux
  lignes seraient identiques — cas de toutes les campagnes historiques 1 à
  12, jamais de `video_display_name` réel). Validé en conditions réelles sur la
  campagne n°20 (resynchronisée seule, aucune autre campagne touchée) :
  `"video 3 - vidéo ciseaux .mp4"` (Barbier) et `"mcc aca pub 3.mp4"`
  (Coiffeur).
- **Campagnes historiques n°1 à 12 : alimentées par import Excel, plus
  jamais par Meta/Calendly.** Le classeur externe (`Synthese_KPI_01_12_
  Detail.xlsx`, hors du dépôt, jamais copié/déplacé dans le projet) devient
  la source de vérité pour ces 12 campagnes ; `sync_locked=true` sur les
  12 (déjà vrai avant cet import, reconfirmé) les exclut définitivement de
  toute synchro Meta ou Calendly future (`lib/sync/syncAllCampaigns.ts`,
  `syncAllCampaignsDailyStats.ts`, `syncAppointments.ts` — logique
  inchangée, déjà en place). **Le dernier fichier importé est toujours la
  référence** : `scripts/import-historical-excel.ts <chemin.xlsx>`
  retrouve chaque ligne par une clé métier stable — jamais par une clé
  technique inventée qui risquerait un doublon — (`campaigns` :
  `client_id`+`campaign_number` ; `audiences` : `campaign_id`+
  `audience_type` ; `videos` : `audience_id`) et **met à jour** la ligne
  déjà connue plutôt que d'en créer une nouvelle ; un futur fichier couvrant
  1→19 remplacera donc simplement les valeurs déjà présentes, jamais un
  doublon (import testé rejoué deux fois de suite : 0 création la 2e fois).
  Lecture du classeur sans dépendance npm ajoutée : `scripts/parse-xlsx.ps1`
  (un `.xlsx` est une archive ZIP de XML, extraite via PowerShell) produit
  un JSON structuré consommé par le script d'import.
  - **Années des dates déterminées automatiquement, jamais devinées** : le
    fichier ne donne que JJ/MM. L'algorithme (`inferYears`) détecte les
    passages d'année par continuité chronologique (le mois de début d'une
    ligne redescend sous le mois de fin de la précédente) puis ancre
    l'ensemble sur la date de début RÉELLE (déjà en base, Meta) de la
    campagne n°13 — la toute première campagne non couverte par le fichier.
    Si cette ancre est absente ou la comparaison ambiguë, l'import s'arrête
    et le signale (jamais de repli sur une année devinée). Résultat vérifié :
    campagne n°12 se termine le 27/02, jour précédant exactement le début
    réel de la campagne n°13 (28/02) — cohérence confirmée avant tout écrit.
  - **Cellule vide = NULL, jamais 0** : `stringCell`/`numberCell`
    (`scripts/import-historical-excel.ts`) ne renvoient jamais de valeur par
    défaut inventée. Le fichier ne fournit pas les compteurs Meta bruts par
    vidéo (`impressions`, `video_plays_3s`, `thruplays`, `video_p25/50/75/
    100`) pour les campagnes qui n'avaient encore aucune ligne vidéo réelle
    (n°1 à 11) : ces colonnes sont devenues nullables (migration
    `20260808000000_historical_excel_import.sql`) plutôt que d'y écrire 0.
    Le fichier fournit en revanche des taux déjà calculés (`Accroche %`/
    `Retention %`) : stockés tels quels dans `videos.hook_rate_pct`/
    `retention_rate_pct` (ratio 0-1, même convention que `hookRate()`/
    `retentionRate()`, `lib/calculations.ts` — non modifié). **Priorité
    d'affichage de ces taux (règle corrigée)** : pour une campagne historique
    verrouillée (`campaign.sync_locked=true`) dont `hook_rate_pct`/
    `retention_rate_pct` sont renseignés, ce sont ces valeurs Excel qui
    s'affichent — **même si d'anciens compteurs Meta bruts existent encore**
    (campagne n°12, qui avait déjà de vraies lignes vidéo avant l'import) :
    le fichier Excel est la source de vérité complète pour 1 à 12, il ne cède
    jamais le pas à un ancien calcul Meta. Pour une campagne dynamique
    (`sync_locked=false`, ex. n°20), c'est l'inverse : toujours le calcul réel
    depuis les compteurs bruts (`hook_rate_pct`/`retention_rate_pct` n'y sont
    de toute façon jamais renseignés par la synchro Meta). Si aucune des deux
    sources n'existe, `"—"`. Implémenté dans `app/dashboard/campaigns/[id]/
    page.tsx` (par vidéo) et `app/dashboard/comparison/page.tsx`
    (`computeRankedVideos`, par groupe — un groupe historique n'est jamais
    partagé avec une campagne dynamique en pratique, clé technique unique par
    campagne+audience). Les compteurs bruts Meta de la campagne n°12
    (`impressions`, `video_plays_3s`, `video_p100`) restent stockés tels
    quels, jamais écrasés ni supprimés — seule leur priorité *visuelle*
    change. Répartition des leads par plateforme
    (`audiences.facebook_leads`/`instagram_leads`, même migration) affichée
    de la même façon, absente pour toute audience Meta réelle.
  - **RDV Calendly historique = `manual_appointments_adjustment`** (jamais
    de fausse ligne `appointments`) : la colonne "RDV Calendly" du fichier
    devient `campaign.manual_appointments_adjustment = RDV_Excel −
    (rendez-vous actifs déjà réellement rattachés à cette campagne)` — une
    formule générique, pas un cas particulier par campagne. Pour les
    campagnes n°1 à 11 (0 rendez-vous réel) l'ajustement vaut directement la
    valeur du fichier. Pour la campagne n°12 (34 rendez-vous Calendly réels
    déjà rattachés avant ce changement), la formule donne 40 − 34 = 6 —
    exactement la valeur déjà en base avant cet import, confirmant sa
    validité sans avoir eu besoin de traiter ce cas à part.
  - **Campagnes 13 et suivantes strictement non concernées** : le script
    arrête l'import (aucune écriture) si une ligne du fichier référence une
    campagne au-delà de `MAX_CAMPAIGN_NUMBER` (12 pour cet incrément).
  - Aucune tranche d'âge dans ce fichier (`appointment_breakdowns` non
    touché, confirmé absent du classeur — cohérent avec l'absence déjà
    documentée côté Calendly).
- **Bouton admin unique « Synchroniser » remplaçant les deux boutons Meta/
  Calendly séparés** (`SyncButton.tsx`, `app/api/admin/sync/all/route.ts`) :
  un clic déclenche les 4 étapes déjà validées, dans cet ordre strict et sans
  jamais les paralléliser — `syncAllCampaigns` (totaux Meta) →
  `syncAllCampaignsDailyStats` (quotidien Meta) → `syncAppointments`
  (rendez-vous Calendly + rattachement campagnes, jamais lancé avant la fin
  des deux étapes Meta ci-dessus) → `syncCalendlyDailyStats` (quotidien
  Calendly). Aucune fonction de synchro modifiée : ce fichier ne fait
  qu'enchaîner les appels existants et construire un rapport. Un échec dur à
  l'étape 1 (totaux Meta) interrompt tout le reste (Calendly jamais lancé) ;
  un échec de l'étape 2 (quotidien Meta) n'interrompt PAS Calendly (le
  rattachement par fenêtre ne dépend que de `campaigns.start_date/end_date`,
  déjà écrites par l'étape 1) ; un échec dur à l'étape 3 (rendez-vous
  Calendly) interrompt l'étape 4. Chaque étape déjà réussie reste dans le
  rapport final même si une étape suivante échoue — jamais de succès global
  affiché si une étape a réellement échoué (`report.ok`, calculé côté
  serveur, ignore les rendez-vous en chevauchement — attendus, pas des
  échecs). Réponse en NDJSON (une ligne JSON par évènement, aucune dépendance
  ajoutée : `ReadableStream`/`TextEncoder` natifs) plutôt qu'un JSON unique :
  seul moyen d'afficher une étape en cours (« Synchronisation Meta… » /
  « Synchronisation Calendly… » / « Finalisation… ») qui reflète l'avancement
  réel du serveur, jamais un minutage deviné côté client. Les deux anciennes
  routes (`app/api/admin/sync/route.ts`, `.../calendly/route.ts`) restent
  intactes pour diagnostic interne, mais ne sont plus exposées dans
  l'interface (`SyncMetaButton.tsx`/`SyncCalendlyButton.tsx` supprimés).
  Gating admin identique aux routes existantes (comparaison directe :
  identique à l'octet près hors un commentaire). Validé en conditions
  réelles : chemin d'échec dur à l'étape 1 déclenché deux fois pour de vraies
  raisons (token Meta expiré, puis limite de débit Meta) — dans les deux cas,
  Calendly n'a jamais été appelé, confirmé par les logs ; réponse readable
  stream/NDJSON testée séparément avec un découpage d'octets pathologique (au
  milieu d'une ligne JSON), parsing toujours correct.

## 6. Tâche immédiate

1. **Audit** du dossier : confirme la présence de `meta-test.mjs`, la version de
   Node (18+ requis pour ce script isolé — le dashboard Next.js ajouté en Phase 1
   exige Node 20.9+), et l'absence de `.env`.
2. **Crée les fichiers manquants** :
   - `.env` (à la racine, à côté du script) :
     ```
     META_ACCESS_TOKEN=<token que je te fournis>
     META_AD_ACCOUNT_ID=act_1490284429391038
     META_API_VERSION=v26.0
     ```
   - `.gitignore` contenant au minimum :
     ```
     node_modules/
     .env
     .env.local
     resultat-meta.txt
     ```
   - `README.md` court : comment lancer le test.
3. **Lance** depuis ce dossier : `node meta-test.mjs`
4. **Ouvre `resultat-meta.txt`** et montre-moi son contenu.

### Étape 2 (après avoir la liste des campagnes)
Je repère l'id de la campagne maître et je te le donne. Ajoute alors dans `.env` :
```
META_CAMPAIGN_ID=<id de la campagne maître>
CAMPAIGN_NUMBER=20
```
Relance `node meta-test.mjs` et rouvre `resultat-meta.txt`.

## 7. Ce qu'on veut vérifier dans la 2e sortie

- Le filtre par préfixe attrape **exactement 2 ad sets** (un « …BARBERS », un
  « …COIFFEUR »).
- Les **stats vidéo** (accroche via play et via thruplay, rétention) remontent
  au niveau des pubs.
- La **liste complète des `action_type`** des conversions, pour repérer celui de
  « Lead - Confirmation de RDV » (à figer ensuite dans `.env` via
  `LEAD_ACTION_TYPE=...`).

---

## 8. Feuille de route (pour info, ne pas coder maintenant)

- **Phase 1 — Fondations** : projet Next.js + Supabase + Vercel. Schéma de
  données (clients, campagnes, audiences barbier/coiffeur, vidéos, leads/RDV).
  Auth Supabase + cloisonnement par client (row-level security).
- **Phase 2 — Synchro** : le « bouton Synchroniser » admin. Parse le numéro,
  regroupe les 2 ad sets, agrège Meta, récupère les RDV Calendly de la fenêtre,
  calcule le coût/RDV, écrit en base.
- **Phase 3 — Front** : brancher la maquette (déjà validée) sur Supabase.
- **Phase 4 — Mise en ligne** : déploiement Vercel + accès connexion client.

## 9. Contraintes & notes

- **Test en lecture seule.** Ne rien modifier sur le compte Meta, ne créer /
  mettre en pause aucune campagne.
- **Toujours lancer depuis le dossier qui contient `.env`**, sinon le script ne
  le lit pas.
- **Token Meta** : durée ≈ 1 h. Erreur code 190 / « expired » → je régénère.
- **Erreur (#100)** : id de compte sans préfixe `act_`, ou token sans `ads_read`.
- Ne jamais committer `.env` (il contient le token).
- Stack cible : **Next.js + Supabase + Vercel** (offres gratuites suffisantes à
  cette échelle).
