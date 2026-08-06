import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Bascule campaigns.published — décision admin exclusive, jamais dérivée du
// statut Meta ni modifiée par la synchro (voir lib/sync/syncCampaign.ts).
// Même structure que app/api/admin/campaigns/end-date/route.ts (gating admin
// identique, campagne revérifiée sur client_id du profil authentifié).
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
  const published = (body as { published?: unknown } | null)?.published

  if (typeof campaignId !== 'string' || !campaignId) {
    return NextResponse.json({ error: 'campaignId requis.' }, { status: 400 })
  }
  if (typeof published !== 'boolean') {
    return NextResponse.json({ error: 'published doit être un booléen.' }, { status: 400 })
  }

  // Le client synchronisé/modifiable est exclusivement celui rattaché au
  // profil de l'utilisateur authentifié — jamais une autre campagne/client.
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('client_id', profile.client_id)
    .maybeSingle()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 })
  }

  // Règle métier officielle (voir BRIEF-CLAUDE-CODE.md) : une campagne
  // publiée est verrouillée DÉFINITIVEMENT — il ne doit jamais exister l'état
  // published=true / sync_locked=false. Publier écrit donc les deux colonnes
  // en une seule instruction UPDATE : un update mono-ligne est atomique par
  // nature côté Postgres (soit les deux valeurs sont écrites ensemble, soit
  // aucune ne l'est si la requête échoue — updateError ci-dessous couvre ce
  // cas, aucune écriture partielle possible). Dépublier n'écrit QUE
  // published=false : sync_locked n'apparaît jamais dans ce payload, donc ne
  // peut jamais être remis à false par cette route (le corps de la requête
  // ne l'accepte d'ailleurs pas en entrée, voir plus haut — aucun vecteur
  // client pour le déverrouiller).
  const updatePayload = published ? { published: true, sync_locked: true } : { published: false }

  const { data: updated, error: updateError } = await supabase
    .from('campaigns')
    .update(updatePayload)
    .eq('id', campaignId)
    .eq('client_id', profile.client_id)
    .select('id, campaign_number, published, sync_locked')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: "Échec de l'enregistrement." }, { status: 500 })
  }

  return NextResponse.json({ campaign: updated })
}
