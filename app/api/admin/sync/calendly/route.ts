import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncAppointments } from '@/lib/sync/syncAppointments'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, client_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  // Le client synchronisé est exclusivement celui rattaché au profil de
  // l'utilisateur authentifié (profiles.client_id) : jamais de slug/nom fixe.
  if (!profile.client_id) {
    return NextResponse.json({ error: 'Aucun client autorisé associé à ce compte.' }, { status: 403 })
  }

  try {
    const result = await syncAppointments(profile.client_id)

    return NextResponse.json({
      read: result.read,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
    })
  } catch (error) {
    console.error('Échec /api/admin/sync/calendly :', error instanceof Error ? error.message : 'erreur inconnue')
    return NextResponse.json({ error: 'Échec de la synchronisation Calendly.' }, { status: 500 })
  }
}
