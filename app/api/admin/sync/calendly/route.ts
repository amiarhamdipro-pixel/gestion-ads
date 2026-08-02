import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncAppointments } from '@/lib/sync/syncAppointments'
import { syncCalendlyDailyStats } from '@/lib/sync/syncCalendlyDailyStats'
import { logError } from '@/lib/logger'

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

  let appointmentsResult
  try {
    appointmentsResult = await syncAppointments(profile.client_id)
  } catch (error) {
    logError('sync', '/api/admin/sync/calendly (appointments)', error instanceof Error ? error.message : 'erreur inconnue')
    return NextResponse.json({ error: 'Échec de la synchronisation Calendly (rendez-vous).' }, { status: 500 })
  }

  const appointments = {
    read: appointmentsResult.read,
    created: appointmentsResult.created,
    updated: appointmentsResult.updated,
    skipped: appointmentsResult.skipped,
    errors: appointmentsResult.errors,
  }

  // Les statistiques quotidiennes ne sont lancées qu'une fois la synchro des
  // rendez-vous terminée — jamais en parallèle. Si elles échouent, les
  // rendez-vous déjà synchronisés restent acquis et l'échec du volet
  // quotidien est renvoyé explicitement, jamais masqué.
  try {
    const dailyResult = await syncCalendlyDailyStats(profile.client_id)

    return NextResponse.json({
      appointments,
      daily: {
        campaignsProcessed: dailyResult.campaignsProcessed,
        daysUpserted: dailyResult.daysWritten,
        daysWithAppointments: dailyResult.daysWithAppointments,
        daysZeroed: dailyResult.daysZeroed,
        errors: 0,
      },
    })
  } catch (error) {
    logError('sync', '/api/admin/sync/calendly (quotidien)', error instanceof Error ? error.message : 'erreur inconnue')
    return NextResponse.json({
      appointments,
      daily: { error: 'Échec de la synchronisation quotidienne Calendly.' },
    })
  }
}
