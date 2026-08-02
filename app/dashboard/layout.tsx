import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from './Header'
import Sidebar from './Sidebar'
import { surfaceAlt } from './format'

// Chrome applicatif partagé par toutes les pages /dashboard/* (MAQUETTE-UI.png :
// header pleine largeur + sidebar). Chaque page continue de charger ses
// propres données métier (campagnes, rendez-vous...) via son propre
// profile.client_id — ce layout ne fournit que ce qui sert au chrome
// (identité client/rôle, dernière synchronisation).
//
// Sidebar mobile/tablette (<=1024px) : bascule en tiroir pur CSS (case à
// cocher masquée + <label htmlFor> comme déclencheurs, sélecteur général
// frère `~`) — aucun JavaScript, aucune dépendance. Le tiroir et le fond
// assombri démarrent à top: 0 (pas une hauteur de header codée en dur : sur
// mobile le header s'empile sur plusieurs lignes et sa hauteur varie) ; le
// header reste visible au-dessus grâce à son z-index supérieur, qui le fait
// simplement recouvrir visuellement le haut du tiroir/fond.
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
    <div style={{ minHeight: '100vh', background: surfaceAlt, fontFamily: 'sans-serif' }}>
      <style>{`
        .amerys-menu-input { position: absolute; opacity: 0; pointer-events: none; }
        .amerys-menu-label { display: none; }
        .amerys-sidebar-close { display: none; }
        .amerys-backdrop { display: none; }
        .amerys-sidebar { padding-top: 22px; }

        @media (max-width: 1024px) {
          .amerys-menu-label { display: inline-flex; }
          .amerys-sidebar-close { display: inline-flex; }
          .amerys-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 45;
            padding-top: 84px;
            transform: translateX(-100%);
            transition: transform 0.22s ease;
            box-shadow: 10px 0 30px rgba(15, 16, 30, 0.14);
          }
          .amerys-menu-input:checked ~ .amerys-body .amerys-sidebar {
            transform: translateX(0);
          }
          .amerys-menu-input:checked ~ .amerys-body .amerys-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(15, 16, 30, 0.42);
            z-index: 44;
          }
        }

        /* Header sur plusieurs lignes en dessous de ~640px (client/rôle/sync
           s'empilent) : le tiroir a besoin de plus de marge en haut pour ne
           pas démarrer sous le header, plus haut à cette largeur. */
        @media (max-width: 640px) {
          .amerys-sidebar { padding-top: 224px; }
        }
      `}</style>

      <input type="checkbox" id="amerys-menu" className="amerys-menu-input" aria-hidden="true" />

      <Header
        clientName={clientName}
        role={profile?.role ?? null}
        isAdmin={isAdmin}
        lastSyncAt={lastSyncAt}
        lastCalendlyModifiedAt={lastCalendlyModifiedAt}
      />

      <div className="amerys-body" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <label htmlFor="amerys-menu" className="amerys-backdrop" aria-hidden="true" />
        <Suspense fallback={null}>
          <Sidebar userName={profile?.full_name ?? user.email ?? 'Utilisateur'} userEmail={user.email ?? ''} />
        </Suspense>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  )
}
