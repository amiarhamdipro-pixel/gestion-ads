-- Ce fichier ne contient volontairement aucune donnée fictive, aucun
-- utilisateur, aucun secret. Le seul insert exécutable (client réel, nom
-- public non sensible) est idempotent via ON CONFLICT (slug) : un rejeu ne
-- crée pas de doublon et ne modifie pas l'id déjà attribué par la base.

-- 1. Client "Formation Barbier" :
insert into public.clients (name, slug)
values ('Formation Barbier', 'formation-barbier')
on conflict (slug) do nothing;

-- 2. Créer un utilisateur Supabase Auth (email/mot de passe) depuis le
--    Dashboard Supabase (Authentication > Users > Add user), ou via l'API
--    admin. Ne pas utiliser l'inscription publique (désactivée).

-- 3. Rattacher cet utilisateur à un profil, en récupérant son id (auth.users.id)
--    et l'id du client créé à l'étape 1 :
--
--    -- Profil admin (voit tout, pas de client_id) :
--    insert into public.profiles (id, client_id, role, full_name)
--    values ('<uuid_auth_users>', null, 'admin', '<nom>');
--
--    -- Profil client (lecture seule, rattaché à un client) :
--    insert into public.profiles (id, client_id, role, full_name)
--    values ('<uuid_auth_users>', '<uuid_clients>', 'client', '<nom>');
