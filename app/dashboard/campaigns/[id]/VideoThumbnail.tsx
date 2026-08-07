'use client'

import { useState } from 'react'

// Affiche une miniature vidéo durable (Supabase Storage, voir page.tsx et
// videos.thumbnail_url — POC campagne n°20 uniquement, écrite par
// lib/sync/syncCampaign.ts, jamais une URL Meta temporaire) : Server
// Component ne peut pas porter un onError sur un <img> (fonction non
// sérialisable vers le client), d'où ce petit Client Component dédié. Si
// l'image échoue à charger (fichier supprimé du bucket, latence réseau...),
// bascule silencieusement vers rien du tout : le conteneur parent (fond
// sombre uni, déjà le placeholder existant) reste visible en dessous —
// jamais une image cassée. Jamais cliquable, aucun lecteur vidéo.
export default function VideoThumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL externe Supabase Storage (voir types.ts) : next/image (optimisation + domaines autorisés figés) hors périmètre pour ce POC.
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  )
}
