'use client'

import { useState } from 'react'

// POC miniature réelle (campagne n°20 uniquement, voir page.tsx et
// lib/sync/meta.ts, fetchVideoThumbnailForAd) : Server Component ne peut pas
// porter un onError sur un <img> (fonction non sérialisable vers le client),
// d'où ce petit Client Component dédié. Si l'image échoue à charger (URL
// Meta signée expirée entre le rendu serveur et l'affichage, latence
// réseau...), bascule silencieusement vers rien du tout : le conteneur
// parent (fond sombre + icône Play, déjà le placeholder existant) reste
// visible en dessous — jamais une image cassée.
export default function VideoThumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL externe Meta CDN, signée/temporaire (voir types.ts) : next/image (optimisation + domaines autorisés figés) hors périmètre pour ce POC.
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  )
}
