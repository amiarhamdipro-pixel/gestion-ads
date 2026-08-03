import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from './Header'
import Sidebar from './Sidebar'
import { ink, surfaceAlt } from './format'

// Chrome applicatif partagé par toutes les pages /dashboard/* (MAQUETTE-UI.png :
// header pleine largeur + sidebar). Chaque page continue de charger ses
// propres données métier (campagnes, rendez-vous...) via son propre
// profile.client_id — ce layout ne fournit que ce qui sert au chrome
// (identité client/rôle, dernière synchronisation).
//
// Sidebar mobile/tablette (<=1024px) : bascule en tiroir CSS piloté par une
// classe (.amerys-sidebar--open), elle-même dérivée de l'état React partagé
// entre Header.tsx et Sidebar.tsx (voir subscribeMobileMenu dans format.ts) —
// aucune dépendance ajoutée. Le tiroir et le fond assombri passent au-dessus
// du header (z-index) plutôt que de réserver un padding-top calé sur sa
// hauteur supposée : pour un compte admin, le header s'empile sur plus de
// lignes que prévu et recouvrait/interceptait alors les clics destinés au
// bouton fermer et aux liens de la sidebar (bug constaté en production).
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, client_id, full_name')
    .eq('id', user.id)
    .maybeSingle()

  let clientName: string | null = null
  let lastSyncAt: string | null = null
  let lastCalendlyModifiedAt: string | null = null
  if (profile?.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', profile.client_id)
      .maybeSingle()
    clientName = client?.name ?? null

    const { data: lastSync } = await supabase
      .from('sync_runs')
      .select('finished_at')
      .eq('client_id', profile.client_id)
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    lastSyncAt = lastSync?.finished_at ?? null

    // syncAppointments() (Calendly) n'écrit pas dans sync_runs — cette table
    // est le journal des synchros Meta (une ligne par campagne, voir
    // lib/sync/syncCampaign.ts) et n'a pas de colonne pour distinguer la
    // source ; y ajouter des lignes Calendly fausserait "Dernière synchro
    // Meta" sans modifier le schéma. Aucun journal dédié à Calendly n'existe
    // pour l'instant : appointments.updated_at (colonne déjà existante) ne
    // donne PAS l'horodatage d'une exécution de synchro (une synchro qui ne
    // change rien n'avance pas cette valeur), seulement celui de la dernière
    // écriture réelle sur un rendez-vous — d'où le libellé "Dernière
    // modification Calendly" dans le header, pas "Dernière synchro".
    const { data: lastAppointmentWrite } = await supabase
      .from('appointments')
      .select('updated_at')
      .eq('client_id', profile.client_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    lastCalendlyModifiedAt = lastAppointmentWrite?.updated_at ?? null
  }

  const isAdmin = profile?.role === 'admin'

  return (
    // color: ink fixe le texte par défaut de tout le chrome dashboard. Sans
    // lui, les éléments qui ne fixent pas leur propre couleur (ex. les <h1>
    // de titre de page) héritent de body { color: var(--foreground) }
    // (app/globals.css), qui bascule en quasi-blanc sous
    // @media (prefers-color-scheme: dark) — courant par défaut sur mobile —
    // sur un fond clair (surfaceAlt) : texte quasi invisible.
    <div style={{ minHeight: '100vh', background: surfaceAlt, color: ink, fontFamily: 'sans-serif' }}>
      <style>{`
        .amerys-menu-label { display: none; }
        .amerys-sidebar-close { display: none; }
        .amerys-backdrop { display: none; }
        .amerys-sidebar { padding-top: 22px; }

        @media (max-width: 1024px) {
          .amerys-menu-label { display: inline-flex; }
          .amerys-sidebar--open .amerys-sidebar-close { display: inline-flex; }
          .amerys-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 70;
            padding-top: 20px;
            transform: translateX(-100%);
            /* cubic-bezier "standard" (Material) : décélération franche en
               fin de course, perçue comme plus naturelle qu'un ease linéaire
               pour un tiroir qui glisse depuis le bord de l'écran. */
            transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 10px 0 30px rgba(15, 16, 30, 0.14);
          }
          .amerys-sidebar--open {
            transform: translateX(0);
          }
          /* Toujours monté (jamais démonté/remonté) pour permettre un fondu
             — un simple mount/unmount React ne peut pas transitionner
             l'opacité, il ne fait qu'apparaître/disparaître d'un coup.
             pointer-events désactivé au repos : invisible, il ne doit
             intercepter ni clic ni focus. */
          .amerys-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(15, 16, 30, 0.42);
            z-index: 65;
            border: 0;
            padding: 0;
            cursor: pointer;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .amerys-backdrop--visible {
            opacity: 1;
            pointer-events: auto;
          }
        }
      `}</style>

      <Header
        clientName={clientName}
        role={profile?.role ?? null}
        isAdmin={isAdmin}
        lastSyncAt={lastSyncAt}
        lastCalendlyModifiedAt={lastCalendlyModifiedAt}
      />

      <div className="amerys-body" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <Suspense fallback={null}>
          <Sidebar
            userName={profile?.full_name ?? user.email ?? 'Utilisateur'}
            userEmail={user.email ?? ''}
            isAdmin={isAdmin}
          />
        </Suspense>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  )
}
