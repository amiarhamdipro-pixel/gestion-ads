import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logout } from './actions'
import SyncMetaButton from './SyncMetaButton'

export default async function DashboardPage() {
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
  if (profile?.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', profile.client_id)
      .maybeSingle()
    clientName = client?.name ?? null
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <h1>Dashboard</h1>
      <p>Connecté en tant que : {user.email}</p>
      <p>Rôle : {profile?.role ?? 'inconnu'}</p>
      <p>Client associé : {clientName ?? '—'}</p>
      {profile?.role === 'admin' ? <SyncMetaButton /> : null}
      <form action={logout}>
        <button type="submit">Se déconnecter</button>
      </form>
    </main>
  )
}
