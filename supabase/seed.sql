-- Ce fichier ne contient volontairement aucune donnée : pas d'UUID inventé,
-- pas d'utilisateur fictif, pas de secret. Il documente la procédure manuelle
-- à suivre une fois le schéma (migrations/) appliqué sur le projet Supabase.

-- 1. Créer le client "Formation Barbier" :
--    insert into public.clients (name, slug) values ('Formation Barbier', 'formation-barbier');

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
