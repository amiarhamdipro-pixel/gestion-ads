import Link from 'next/link'
import AuthShell from '../AuthShell'
import { accent } from '../dashboard/format'

// Page « accès interdit » réutilisable et cohérente avec le thème. Les
// gardes existants (ex. /dashboard/admin/users pour un rôle non-admin)
// redirigent déjà silencieusement vers /dashboard — comportement testé et
// volontairement inchangé. Cette page est disponible pour un usage explicite
// futur sans modifier les flux de contrôle d'accès déjà en place.
export default function ForbiddenPage() {
  return (
    <AuthShell title="Accès refusé" subtitle="Vous n'avez pas les droits nécessaires pour accéder à cette page.">
      <div style={{ textAlign: 'center' }}>
        <Link href="/dashboard" style={{ fontSize: 13.5, fontWeight: 700, color: accent, textDecoration: 'none' }}>
          ← Retour au tableau de bord
        </Link>
      </div>
    </AuthShell>
  )
}
