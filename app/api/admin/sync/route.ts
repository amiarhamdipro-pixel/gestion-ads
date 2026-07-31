import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncAllCampaigns } from '@/lib/sync/syncAllCampaigns'

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

  try {
    const report = await syncAllCampaigns({
      clientId: profile.client_id,
      metaCampaignId,
      leadActionType: process.env.LEAD_ACTION_TYPE,
    })

    return NextResponse.json({
      totalDetected: report.totalDetected,
      succeeded: report.succeeded,
      failed: report.failed,
      invalid: report.invalid,
      details: report.details.map((detail) =>
        detail.status === 'success'
          ? {
              campaignNumber: detail.campaignNumber,
              status: 'success' as const,
              campaign: { id: detail.result.campaign.id, name: detail.result.campaign.name },
              counts: { audiences: detail.result.audiences.length, videos: detail.result.videos.length },
            }
          : { campaignNumber: detail.campaignNumber, status: 'failed' as const, message: detail.message }
      ),
    })
  } catch (error) {
    console.error('Échec /api/admin/sync :', error instanceof Error ? error.message : 'erreur inconnue')
    return NextResponse.json({ error: 'Échec de la synchronisation.' }, { status: 500 })
  }
}
