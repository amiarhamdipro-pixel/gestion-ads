// Upload d'une miniature vidéo vers Supabase Storage (bucket
// "video-thumbnails", public — vérifié inexistant avant création, voir le
// rapport de tâche). POC campagne n°20 uniquement : appelée exclusivement
// depuis lib/sync/syncCampaign.ts, jamais depuis le front (voir
// app/dashboard/campaigns/[id]/page.tsx, qui lit uniquement
// videos.thumbnail_url déjà stocké). Aucun secret ici : ni le token Meta ni
// l'URL Meta temporaire ne transitent par ce module — seuls des octets
// d'image déjà téléchargés (voir lib/sync/meta.ts, downloadVideoThumbnailImage)
// entrent en entrée, une URL Supabase Storage publique ressort en sortie.

import { createAdminClient } from '@/lib/supabase/admin'

const THUMBNAIL_BUCKET = 'video-thumbnails'

// Chemin déterministe : même vidéo -> même chemin, à chaque synchro — upload
// idempotent via upsert:true (écrase l'ancien fichier au même chemin plutôt
// que d'en créer un nouveau), jamais de doublon accumulé au fil des resyncs.
function thumbnailStoragePath(clientId: string, campaignNumber: number, videoId: string): string {
  return `${clientId}/campaign-${campaignNumber}/${videoId}.jpg`
}

// Ne lève jamais : un échec d'upload (bucket inaccessible, réseau,
// permissions...) retourne null, jamais une exception qui ferait échouer
// syncCampaign pour un problème de miniature (voir son appelant).
export async function uploadVideoThumbnail(
  supabase: ReturnType<typeof createAdminClient>,
  params: { clientId: string; campaignNumber: number; videoId: string; imageBuffer: Buffer }
): Promise<string | null> {
  const path = thumbnailStoragePath(params.clientId, params.campaignNumber, params.videoId)

  try {
    const { error } = await supabase.storage.from(THUMBNAIL_BUCKET).upload(path, params.imageBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })
    if (error) return null

    const { data } = supabase.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path)
    return data.publicUrl
  } catch {
    return null
  }
}
