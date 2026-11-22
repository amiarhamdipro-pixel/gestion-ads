import { ImageResponse } from 'next/og'
import { brandFaviconDataUri } from './brand-image'

// Icône d'onglet / favicon moderne (convention App Router — voir aussi
// apple-icon.tsx, opengraph-image.tsx, twitter-image.tsx). Source : favicon
// officiel du kit Amerys (public/brand/favicon-64.png, voir app/brand.ts),
// restitué tel quel à sa taille native 64×64 (aucune mise à l'échelle,
// aucune recoloration) ; le navigateur le réduit lui-même pour l'onglet.
// Le badge a son propre fond sombre circulaire : lisible sur une barre
// d'onglets claire comme sombre.
const faviconSrc = brandFaviconDataUri()

export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendu par Satori (next/og), pas le navigateur : next/image inutilisable ici. */}
        <img src={faviconSrc} width={64} height={64} alt="" />
      </div>
    ),
    { ...size }
  )
}
