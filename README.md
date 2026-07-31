# Projet web ADS — Dashboard campagnes (Amerys)

Contexte complet : voir `BRIEF-CLAUDE-CODE.md` (dossier parent).

## Prérequis
- Node.js 20.9.0 ou supérieur (exigé par Next.js 16). Seul `meta-test.mjs`
  (Phase 0, script isolé) reste compatible Node 18+.
- Un projet Supabase (Phase 1 : auth + base de données).

## Installation
```
npm install
```

## Variables d'environnement
Copier `.env.example` en `.env` et renseigner :

```env
# Meta (Phase 0 — voir meta-test.mjs)
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
META_API_VERSION=
META_CAMPAIGN_ID=
CAMPAIGN_NUMBER=

# Supabase (Phase 1)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`.env` n'est **jamais commité** (il contient des secrets) — il est ignoré par `.gitignore`.
Sans les variables Supabase, l'app se build normalement mais l'auth et les pages
`/login`/`/dashboard` ne pourront pas fonctionner en local.

## Lancement local
```
npm run dev
```

## Lint / build
```
npm run lint
npm run build
```

## Migrations Supabase
Le schéma vit dans `supabase/migrations/` (SQL brut, idempotent). La CLI
Supabase est configurée (`supabase/config.toml`, `supabase` en devDependency) :

```
npx supabase login                              # authentification (unique, interactive)
npx supabase link --project-ref <project-ref>    # une fois, relie ce dossier au projet distant
npx supabase db push --linked                    # applique les migrations non encore jouées
npx supabase db push --linked --include-seed     # applique aussi supabase/seed.sql
```

`<project-ref>` : identifiant du projet, visible dans l'URL du dashboard
Supabase (`https://supabase.com/dashboard/project/<project-ref>`). Aucune
migration n'est appliquée automatiquement par ce dépôt.

## Création des utilisateurs
Pas d'inscription publique : les comptes sont créés manuellement depuis le
Dashboard Supabase (Authentication > Users), puis rattachés à un profil
(`admin` ou `client`) via `supabase/seed.sql` (procédure commentée, sans
données réelles ni secret).

## Test Meta (Phase 0)
```
node meta-test.mjs
```
Le résultat s'affiche à l'écran et est écrit dans `resultat-meta.txt`.
