import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncCampaign } from '@/lib/sync/syncCampaign'

export async function POST(request: Request) {
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 })
  }

  const campaignNumber = (body as { campaignNumber?: unknown } | null)?.campaignNumber
  if (typeof campaignNumber !== 'number' || !Number.isInteger(campaignNumber) || campaignNumber <= 0) {
    return NextResponse.json({ error: 'campaignNumber doit être un entier positif.' }, { status: 400 })
  }

  const metaCampaignId = process.env.META_CAMPAIGN_ID
  if (!metaCampaignId) {
    return NextResponse.json({ error: 'Synchronisation indisponible (configuration serveur).' }, { status: 500 })
  }

  try {
    const result = await syncCampaign({
      clientId: profile.client_id,
      metaCampaignId,
      campaignNumber,
      leadActionType: process.env.LEAD_ACTION_TYPE,
    })

    return NextResponse.json({
      campaign: { id: result.campaign.id, name: result.campaign.name, status: result.campaign.status },
      audiences: result.audiences.map((audience) => ({ id: audience.id, audience_type: audience.audience_type })),
      videos: result.videos.map((video) => ({ id: video.id })),
      counts: { audiences: result.audiences.length, videos: result.videos.length },
    })
  } catch (error) {
    console.error('Échec /api/admin/sync :', error instanceof Error ? error.message : 'erreur inconnue')
    return NextResponse.json({ error: 'Échec de la synchronisation.' }, { status: 500 })
  }
}
