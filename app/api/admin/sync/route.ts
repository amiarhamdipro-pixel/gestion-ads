import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncAllCampaigns } from '@/lib/sync/syncAllCampaigns'
import { syncAllCampaignsDailyStats } from '@/lib/sync/syncAllCampaignsDailyStats'
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

  const metaCampaignId = process.env.META_CAMPAIGN_ID
  if (!metaCampaignId) {
    return NextResponse.json({ error: 'Synchronisation indisponible (configuration serveur).' }, { status: 500 })
  }

  const syncParams = {
    clientId: profile.client_id,
    metaCampaignId,
    leadActionType: process.env.LEAD_ACTION_TYPE,
  }

  let totalsReport
  try {
    totalsReport = await syncAllCampaigns(syncParams)
  } catch (error) {
    logError('sync', '/api/admin/sync (totaux)', error instanceof Error ? error.message : 'erreur inconnue')
    return NextResponse.json({ error: 'Échec de la synchronisation des totaux.' }, { status: 500 })
  }

  const totals = {
    totalDetected: totalsReport.totalDetected,
    succeeded: totalsReport.succeeded,
    failed: totalsReport.failed,
    invalid: totalsReport.invalid,
    details: totalsReport.details.map((detail) =>
      detail.status === 'success'
        ? {
            campaignNumber: detail.campaignNumber,
            status: 'success' as const,
            campaign: { id: detail.result.campaign.id, name: detail.result.campaign.name },
            counts: { audiences: detail.result.audiences.length, videos: detail.result.videos.length },
          }
        : { campaignNumber: detail.campaignNumber, status: 'failed' as const, message: detail.message }
    ),
  }

  // La synchro quotidienne n'est lancée qu'une fois la synchro des totaux
  // terminée (succès ou échecs partiels déjà journalisés ci-dessus) — jamais
  // en parallèle. Si elle échoue de façon inattendue (ex. la découverte des
  // campagnes échoue), les totaux déjà synchronisés restent acquis et
  // l'échec du volet quotidien est renvoyé explicitement, jamais masqué.
  try {
    const dailyReport = await syncAllCampaignsDailyStats(syncParams)

    const daily = {
      totalDetected: dailyReport.totalDetected,
      succeeded: dailyReport.succeeded,
      failed: dailyReport.failed,
      stoppedOnRateLimit: dailyReport.stoppedOnRateLimit,
      invalid: dailyReport.invalid,
      daysUpserted: dailyReport.details.reduce(
        (sum, detail) => sum + (detail.status === 'success' ? detail.result.daysUpserted : 0),
        0
      ),
      details: dailyReport.details.map((detail) =>
        detail.status === 'success'
          ? {
              campaignNumber: detail.campaignNumber,
              status: 'success' as const,
              daysUpserted: detail.result.daysUpserted,
            }
          : { campaignNumber: detail.campaignNumber, status: 'failed' as const, message: detail.message }
      ),
    }

    return NextResponse.json({ totals, daily })
  } catch (error) {
    logError('sync', '/api/admin/sync (quotidien)', error instanceof Error ? error.message : 'erreur inconnue')
    return NextResponse.json({
      totals,
      daily: { error: 'Échec de la synchronisation quotidienne.' },
    })
  }
}
