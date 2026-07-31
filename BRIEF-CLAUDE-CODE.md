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
- **API Calendly** (à brancher plus tard) : nombre réel de rendez-vous + la
  plateforme (Instagram / Facebook) via un sélecteur du formulaire. **Source de
  vérité** pour les rendez-vous.
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
- `LEAD_ACTION_TYPE` **non figé** : candidat le plus probable observé —
  `offsite_conversion.custom.4312192355693474` — à confirmer manuellement
  (Gestionnaire d'événements Meta, conversions personnalisées) avant de
  l'utiliser dans la synchro.

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
- **Non testé en écriture réelle** : aucun projet Supabase n'est encore
  configuré (`.env` ne contient toujours aucune variable `SUPABASE_*`/
  `NEXT_PUBLIC_SUPABASE_*`). Reste à faire avant un premier run complet :
  créer le projet Supabase, appliquer la migration, renseigner `.env`, créer
  la ligne `clients` (Formation Barbier) via `supabase/seed.sql`.
- Calendly toujours non branché : `calendly_appointments` et
  `manual_appointments_adjustment` restent à 0 (défaut DB) tant que la
  synchro Calendly n'existe pas ; `syncCampaign` ne les écrase jamais.

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
