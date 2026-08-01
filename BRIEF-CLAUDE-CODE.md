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
