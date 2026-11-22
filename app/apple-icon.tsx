import { ImageResponse } from 'next/og'
import { brandIconDataUri } from './brand-image'

// Apple touch icon (écran d'accueil iOS/iPadOS, 180×180 — taille officielle
// recommandée par Apple). Source : symbole officiel du kit Amerys
// (public/brand/amerys-icone.png, 512×512, voir app/brand.ts), réduit à
// 180 px, jamais redessiné ni recoloré.
// Fond OBLIGATOIREMENT opaque (pas de transparence) : iOS ne gère pas la
// transparence sur cette icône et peut afficher les zones transparentes en
// noir. Les coins transparents du badge circulaire sont donc posés sur le
// fond principal de la charte (#09070E), proche du fond du badge.
// iOS applique lui-même l'arrondi/l'ombre : aucun borderRadius ici.
const iconSrc = brandIconDataUri()

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#09070E',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rendu par Satori (next/og), pas le navigateur. */}
        <img src={iconSrc} width={180} height={180} alt="" />
      </div>
    ),
    { ...size }
  )
}
