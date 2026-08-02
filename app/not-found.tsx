import Link from 'next/link'
import AuthShell from './AuthShell'
import { accent } from './dashboard/format'

export default function NotFound() {
  return (
    <AuthShell title="Page introuvable" subtitle="Cette page n'existe pas ou a été déplacée.">
      <div style={{ textAlign: 'center' }}>
        <Link href="/dashboard" style={{ fontSize: 13.5, fontWeight: 700, color: accent, textDecoration: 'none' }}>
          ← Retour au tableau de bord
        </Link>
      </div>
    </AuthShell>
  )
}
