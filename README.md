# AMERYS ADS — Dashboard de suivi des campagnes

Dashboard interne (Next.js + Supabase) présentant à Amerys Agency et à ses
clients les résultats de leurs campagnes publicitaires Meta et les
rendez-vous Calendly associés. Contexte métier complet, règles de calcul et
historique détaillé des phases de développement : voir **`BRIEF-CLAUDE-CODE.md`**.

Production : https://ads.amerys-agency.com

---

## Architecture du projet

```
app/
  page.tsx                    Redirection serveur vers /login
  layout.tsx                  Layout racine (lang="fr")
  error.tsx / global-error.tsx / not-found.tsx   Pages système (voir plus bas)
  login/                      Connexion (Supabase Auth email/mot de passe)
  forgot-password/            Demande de réinitialisation de mot de passe
  update-password/            Saisie du nouveau mot de passe (lien e-mail)
  auth/confirm/route.ts       Callback Supabase (échange le lien reçu par e-mail contre une session)
  forbidden/                  Page « accès refusé » réutilisable
  AuthShell.tsx, auth-ui.tsx  Composants partagés aux écrans d'authentification
  api/admin/                  Routes API admin (synchro Meta, Calendly, édition campagne)
  dashboard/
    layout.tsx, Header.tsx, Sidebar.tsx    Chrome applicatif partagé
    page.tsx                  Vue d'ensemble
    campaigns/[id]/page.tsx   Détail d'une campagne
    comparison/page.tsx       Comparaison entre campagnes
    admin/users/              Administration des comptes (admin uniquement)
    format.ts                 Palette, typographie, formatage — source unique du thème
    icons.tsx                 Icônes SVG maison (aucune dépendance d'icônes)
    loading.tsx                État de chargement (Suspense) pour /dashboard/*

lib/
  supabase/                   Clients Supabase (browser / server / admin service_role)
  sync/                       Orchestration des synchros Meta et Calendly
  calendly/                   Client Calendly en lecture seule
  calculations.ts             Fonctions de calcul pures (coût/RDV, dates, périodes...)
  logger.ts                   Journalisation légère (erreurs critiques/API/synchro)
  site.ts                     URL publique du site (liens Supabase Auth)

types/database.ts             Types Supabase (maintenus manuellement)
supabase/migrations/          Schéma SQL versionné (jamais modifié rétroactivement)
scripts/                      Scripts de test ponctuels (lecture/synchro réelles, jetables)
proxy.ts                      Middleware Next.js 16 : rafraîchit la session Supabase et
                               protège /dashboard/* (redirige vers /login si non connecté)
next.config.ts                En-têtes de sécurité HTTP
```

---

## Prérequis
- Node.js 20.9.0 ou supérieur (exigé par Next.js 16). Seul `meta-test.mjs`
  (script isolé, hors app Next.js) reste compatible Node 18+.
- Un projet Supabase (Auth + Postgres + RLS déjà configurés, voir
  `supabase/migrations/`).

## Installation
```
npm install
```

## Variables d'environnement
Copier `.env.example` en `.env` et renseigner :

```env
# Meta
META_ACCESS_TOKEN=            # durée de vie courte (~1h) : se régénère en cas d'erreur code 190
META_AD_ACCOUNT_ID=
META_API_VERSION=
META_CAMPAIGN_ID=
CAMPAIGN_NUMBER=
LEAD_ACTION_TYPE=             # conversion perso "Lead - Confirmation de RDV"

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # secret — jamais exposé au navigateur (voir lib/supabase/admin.ts)

# Calendly
CALENDLY_ACCESS_TOKEN=
CALENDLY_ORGANIZATION_URI=
CALENDLY_ACQUISITION_CHANNEL_QUESTION=   # optionnel, texte de la question si reformulée

# Site
NEXT_PUBLIC_SITE_URL=         # URL publique (production : https://ads.amerys-agency.com)
                               # En local : à laisser vide (repli automatique sur
                               # http://localhost:3000, voir lib/site.ts) — ne
                               # JAMAIS y mettre http://0.0.0.0:3000 (adresse
                               # d'écoute serveur affichée par `next dev`, pas une
                               # adresse de destination valide pour un navigateur ;
                               # produit ERR_ADDRESS_INVALID sur le lien de
                               # réinitialisation de mot de passe reçu par e-mail).
```

`.env` n'est **jamais commité** (ignoré par `.gitignore`). Sans les variables
Supabase, l'app se build normalement mais l'auth et les pages `/login` /
`/dashboard` ne fonctionneront pas en local.

## Lancement local
```
npm run dev
```

## Commandes utiles
```
npm run dev         # serveur de développement
npm run build       # build de production
npm run start        # démarre le build de production
npm run lint         # ESLint
npm run typecheck    # TypeScript (tsc --noEmit)
```

---

## Authentification
- Connexion par e-mail/mot de passe (Supabase Auth), page `/login`.
- **Mot de passe oublié** : lien depuis `/login` → `/forgot-password` (envoi
  d'un e-mail Supabase) → lien reçu → `/auth/confirm` (échange le lien contre
  une session) → `/update-password` (nouveau mot de passe) → `/dashboard`.
- Session rafraîchie automatiquement par `proxy.ts` sur chaque requête vers
  `/dashboard/*` et `/login` ; redirection propre vers `/login` si la session
  est absente ou expirée.
- **Pas d'inscription publique.** Les comptes sont créés depuis
  `/dashboard/admin/users` (rôle admin uniquement) : e-mail, mot de passe
  temporaire, rôle (`admin`/`client`), client associé. Cette page permet
  aussi de réinitialiser le mot de passe d'un compte, de le désactiver
  temporairement ou de le supprimer définitivement.

## Synchronisation
Déclenchée manuellement par un admin depuis les boutons du tableau de bord
(jamais automatique, jamais de webhook) :
- **Synchroniser** (Meta) : campagnes/audiences/vidéos, puis statistiques
  quotidiennes (`campaign_daily_stats`) — deux étapes chaînées en un clic.
- **Synchroniser Calendly** : rendez-vous, puis statistiques quotidiennes
  Calendly — également chaînées.

Chaque étape journalise son propre rapport (succès/échecs/détails) sans
jamais masquer un échec partiel. Le détail du fonctionnement (idempotence,
gestion du rate-limit Meta, fuseau Europe/Paris...) est documenté dans
`BRIEF-CLAUDE-CODE.md`.

## Pages système
- **404** (`app/not-found.tsx`) : route inexistante.
- **Erreur** (`app/error.tsx`, `app/global-error.tsx`) : exception non gérée —
  message générique, jamais de trace technique ni de détail d'erreur brut.
- **Accès refusé** (`app/forbidden/page.tsx`) : page réutilisable (les gardes
  d'accès existants redirigent silencieusement, ce qui reste inchangé).
- **Chargement** (`app/dashboard/loading.tsx`) : état affiché pendant le
  chargement des données de toute page `/dashboard/*`.

## Sécurité
- RLS activée sur toutes les tables, cloisonnement strict par client
  (`profiles.client_id`) — voir `supabase/migrations/`.
- `service_role` (contournement RLS) utilisé exclusivement côté serveur
  (`lib/supabase/admin.ts`), jamais dans un composant client.
- En-têtes HTTP de sécurité (`next.config.ts`) : `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  `Strict-Transport-Security`.
- Aucun secret ni donnée personnelle dans les journaux (`lib/logger.ts` :
  uniquement des messages d'erreur déjà filtrés, jamais un objet brut).

## Monitoring
Journalisation légère via `lib/logger.ts` (`logError(category, contexte,
message)`), catégories `api` / `sync` / `critical` uniquement — vers
stdout/stderr, capturé nativement par la plateforme de déploiement (aucun
service tiers, aucune dépendance ajoutée). Jamais de donnée personnelle ni de
secret journalisé.

---

## Migrations Supabase
Le schéma vit dans `supabase/migrations/` (SQL brut, idempotent, jamais
modifié rétroactivement — seules de nouvelles migrations sont ajoutées). La
CLI Supabase est en devDependency :

```
npx supabase login                              # authentification (unique, interactive)
npx supabase link --project-ref <project-ref>    # une fois, relie ce dossier au projet distant
npx supabase migration list --linked             # état des migrations appliquées
npx supabase db push --linked                    # applique les migrations non encore jouées
```

`<project-ref>` : identifiant du projet, visible dans l'URL du dashboard
Supabase (`https://supabase.com/dashboard/project/<project-ref>`). Aucune
migration n'est appliquée automatiquement par ce dépôt.

## Sauvegarde
- **Automatique (recommandé)** : Supabase gère des sauvegardes quotidiennes
  (et la restauration à un point dans le temps sur les plans qui l'incluent)
  depuis *Dashboard Supabase → Database → Backups*.
- **Manuelle (ponctuelle)**, via la CLI déjà présente :
  ```
  npx supabase db dump --linked -f backup.sql
  ```
  Ne jamais committer ce fichier (données de production).

## Restauration
- Depuis une sauvegarde automatique : *Dashboard Supabase → Database →
  Backups → Restore*.
- Depuis un dump manuel :
  ```
  psql "<connection-string-projet-supabase>" -f backup.sql
  ```
  À utiliser avec prudence (écrase les données existantes) — toujours sur un
  projet de test avant toute restauration en production.

## Déploiement
Stack cible : **Next.js (Vercel) + Supabase**.
1. Renseigner toutes les variables d'environnement (voir ci-dessus) dans les
   *Environment Variables* du projet Vercel — `NEXT_PUBLIC_SITE_URL` doit
   pointer vers le domaine de production (`https://ads.amerys-agency.com`).
2. Dans *Supabase → Authentication → URL Configuration* :
   - **Site URL** : `https://ads.amerys-agency.com` (jamais une adresse
     d'écoute type `0.0.0.0` — Supabase l'utilise comme repli pour construire
     le lien envoyé par e-mail quand `redirectTo` n'est pas dans la liste
     ci-dessous, donc une valeur invalide y casse le lien même si le code
     applicatif est correct).
   - **Redirect URLs** : ajouter `https://ads.amerys-agency.com/**` (production)
     et `http://localhost:3000/**` (développement local) — requis pour que le
     lien de réinitialisation de mot de passe fonctionne dans les deux
     environnements.
3. Appliquer les migrations sur le projet Supabase de production
   (`npx supabase db push --linked`, voir ci-dessus) avant la mise en ligne.
4. Déployer (`vercel --prod` ou via l'intégration Git de Vercel). Le build
   (`next build`) échoue si une erreur TypeScript/ESLint est présente.

## Création des utilisateurs
Pas d'inscription publique : les comptes sont créés depuis
`/dashboard/admin/users` (voir section Authentification ci-dessus). Un
premier compte admin doit être créé manuellement depuis *Dashboard Supabase →
Authentication → Users*, puis rattaché à un profil `admin` via
`supabase/seed.sql` (procédure commentée, sans donnée réelle ni secret) —
uniquement nécessaire pour amorcer le tout premier compte.

## Test Meta (Phase 0)
```
node meta-test.mjs
```
Le résultat s'affiche à l'écran et est écrit dans `resultat-meta.txt`
(script isolé, indépendant de l'application Next.js).
