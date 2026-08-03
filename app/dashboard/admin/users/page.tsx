import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import UserCreateForm from './UserCreateForm'
import UserRowActions from './UserRowActions'
import { formatDateTime, green, ink, line, muted, radius, red, softBg, surface, surfaceAlt } from '../../format'

// Page admin uniquement : accès direct par URL sans le rôle admin renvoie
// vers /dashboard (redirect(), même garde que les pages non authentifiées).
// La lecture (profils + e-mails/dates Auth) passe par service_role car
// auth.admin.listUsers() ne peut pas être appelé avec la clé anon — jamais
// exposé au navigateur, ce fichier est un Server Component. created_at et
// last_sign_in_at viennent tels quels de listUsers() (déjà appelée pour les
// e-mails) : aucune requête supplémentaire, aucun changement de schéma.
export default async function AdminUsersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()

  if (profile?.role !== 'admin') {
    redirect('/dashboard')
  }

  const adminSupabase = createAdminClient()

  const [{ data: profilesRaw }, { data: clientsRaw }, { data: authUsers }] = await Promise.all([
    adminSupabase.from('profiles').select('id, client_id, role, full_name').order('created_at', { ascending: true }),
    adminSupabase.from('clients').select('id, name').order('name', { ascending: true }),
    adminSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  const clients = clientsRaw ?? []
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]))
  const authById = new Map((authUsers?.users ?? []).map((u) => [u.id, u]))

  const rows = (profilesRaw ?? []).map((p) => {
    const authUser = authById.get(p.id)
    const isBanned = !!authUser?.banned_until && new Date(authUser.banned_until) > new Date()
    return {
      id: p.id,
      email: authUser?.email ?? '—',
      role: p.role,
      clientName: p.client_id ? (clientNameById.get(p.client_id) ?? '—') : '—',
      createdAt: authUser?.created_at ?? null,
      lastSignInAt: authUser?.last_sign_in_at ?? null,
      isBanned,
      isSelf: p.id === user.id,
    }
  })

  return (
    <main style={{ padding: '40px 40px 64px' }}>
      <style>{`
        .amerys-card-list { display: none; }
        @media (max-width: 640px) {
          .amerys-table-wrap { display: none; }
          .amerys-card-list { display: flex; }
        }
      `}</style>

      <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>Utilisateurs</h1>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Administration des comptes</p>

      <div
        style={{
          marginTop: 28,
          marginBottom: 32,
          background: surface,
          border: `1px solid ${line}`,
          borderRadius: radius,
          padding: 20,
        }}
      >
        <h2 style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Créer un utilisateur</h2>
        <UserCreateForm clients={clients} />
      </div>

      <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 16 }}>Comptes existants</h2>

      <div
        className="amerys-table-wrap"
        style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
            <thead>
              <tr>
                {['E-mail', 'Rôle', 'Client', 'Statut', 'Créé le', 'Dernière connexion', 'Actions'].map((label) => (
                  <th
                    key={label}
                    style={{
                      textAlign: 'left',
                      padding: '13px 16px',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '.04em',
                      textTransform: 'uppercase',
                      color: muted,
                      background: surfaceAlt,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} style={{ borderTop: index === 0 ? 'none' : `1px solid ${line}` }}>
                  <td style={{ padding: '14px 16px', fontSize: 13.5 }}>{row.email}</td>
                  <td style={{ padding: '14px 16px', fontSize: 13.5, textTransform: 'capitalize' }}>{row.role}</td>
                  <td style={{ padding: '14px 16px', fontSize: 13.5 }}>{row.clientName}</td>
                  <td style={{ padding: '14px 16px', fontSize: 12.5 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '3px 9px',
                        borderRadius: 999,
                        fontWeight: 600,
                        // color: ink, pas red/green — sur leur propre fond
                        // pâle (softBg), red/green tombe autour de 2-3:1 de
                        // contraste ; ink y reste très lisible (~17:1).
                        color: ink,
                        background: row.isBanned ? softBg(red, 0.12) : softBg(green, 0.12),
                      }}
                    >
                      {row.isBanned ? 'Désactivé' : 'Actif'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 12.5, color: muted, whiteSpace: 'nowrap' }}>
                    {formatDateTime(row.createdAt, '—')}
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 12.5, color: muted, whiteSpace: 'nowrap' }}>
                    {formatDateTime(row.lastSignInAt, 'Jamais connecté')}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <UserRowActions userId={row.id} email={row.email} isBanned={row.isBanned} isSelf={row.isSelf} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="amerys-card-list" style={{ flexDirection: 'column', gap: 12 }}>
        {rows.map((row) => (
          <div key={row.id} style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{row.email}</div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 9px',
                  borderRadius: 999,
                  color: ink,
                  background: row.isBanned ? softBg(red, 0.12) : softBg(green, 0.12),
                }}
              >
                {row.isBanned ? 'Désactivé' : 'Actif'}
              </span>
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12.5, color: muted }}>
              <span style={{ textTransform: 'capitalize' }}>Rôle : {row.role}</span>
              <span>Client : {row.clientName}</span>
              <span>Créé le {formatDateTime(row.createdAt, '—')}</span>
              <span>Dernière connexion : {formatDateTime(row.lastSignInAt, 'Jamais connecté')}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <UserRowActions userId={row.id} email={row.email} isBanned={row.isBanned} isSelf={row.isSelf} />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
