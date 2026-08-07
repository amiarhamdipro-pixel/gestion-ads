import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// Apple touch icon (écran d'accueil iOS/iPadOS, 180×180 — taille officielle
// recommandée par Apple). Même source unique que icon.tsx (public/amerys-icon.png,
// jamais redessiné/recoloré), composée sur le même fond `headerBg` (#1E1B4B,
// app/dashboard/format.ts) déjà utilisé partout ailleurs derrière ce logo.
// Fond OBLIGATOIREMENT opaque (pas de transparence) : iOS ne gère pas la
// transparence sur cette icône et peut afficher les zones transparentes en
// noir — contrainte technique documentée par Apple, pas un choix esthétique.
// iOS applique lui-même l'arrondi/l'ombre : aucun borderRadius ici.
const logoSrc = `data:image/png;base64,${readFileSync(join(process.cwd(), 'public/amerys-icon.png')).toString('base64')}`

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
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1E1B4B',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rendu par Satori (next/og), pas le navigateur. */}
        <img src={logoSrc} width={124} height={107} alt="" />
      </div>
    ),
    { ...size }
  )
}
