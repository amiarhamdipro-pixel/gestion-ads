import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import UserCreateForm from './UserCreateForm'
import { faint, line, muted, radius, surface, surfaceAlt } from '../../format'

// Page admin uniquement : accès direct par URL sans le rôle admin renvoie
// vers /dashboard (redirect(), même garde que les pages non authentifiées).
// La lecture (profils + e-mails Auth) passe par service_role car
// auth.admin.listUsers() ne peut pas être appelé avec la clé anon — jamais
// exposé au navigateur, ce fichier est un Server Component.
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
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? '—']))

  const rows = (profilesRaw ?? []).map((p) => ({
    id: p.id,
    email: emailById.get(p.id) ?? '—',
    role: p.role,
    clientName: p.client_id ? (clientNameById.get(p.client_id) ?? '—') : '—',
  }))

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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
            <thead>
              <tr>
                {['E-mail', 'Rôle', 'Client'].map((label) => (
                  <th
                    key={label}
                    style={{
                      textAlign: 'left',
                      padding: '13px 16px',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '.04em',
                      textTransform: 'uppercase',
                      color: faint,
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="amerys-card-list" style={{ flexDirection: 'column', gap: 12 }}>
        {rows.map((row) => (
          <div key={row.id} style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{row.email}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12.5, color: muted }}>
              <span style={{ textTransform: 'capitalize' }}>Rôle : {row.role}</span>
              <span>Client : {row.clientName}</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
