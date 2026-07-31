import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

  if (!profile.client_id) {
    return NextResponse.json({ error: 'Aucun client autorisé associé à ce compte.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 })
  }

  const campaignId = (body as { campaignId?: unknown } | null)?.campaignId
  const endDate = (body as { endDate?: unknown } | null)?.endDate

  if (typeof campaignId !== 'string' || !campaignId) {
    return NextResponse.json({ error: 'campaignId requis.' }, { status: 400 })
  }
  if (typeof endDate !== 'string' || !DATE_PATTERN.test(endDate) || Number.isNaN(new Date(endDate).getTime())) {
    return NextResponse.json({ error: 'endDate doit être une date valide (AAAA-MM-JJ).' }, { status: 400 })
  }

  // Le client synchronisé/modifiable est exclusivement celui rattaché au
  // profil de l'utilisateur authentifié — jamais une autre campagne/client.
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, start_date')
    .eq('id', campaignId)
    .eq('client_id', profile.client_id)
    .maybeSingle()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 })
  }

  if (campaign.start_date && endDate < campaign.start_date) {
    return NextResponse.json(
      { error: 'La date de fin ne peut pas être antérieure à la date de début.' },
      { status: 400 }
    )
  }

  const { data: updated, error: updateError } = await supabase
    .from('campaigns')
    .update({ end_date: endDate })
    .eq('id', campaignId)
    .eq('client_id', profile.client_id)
    .select('id, campaign_number, start_date, end_date')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: "Échec de l'enregistrement." }, { status: 500 })
  }

  return NextResponse.json({ campaign: updated })
}
