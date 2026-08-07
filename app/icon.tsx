import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// Icône d'onglet / favicon moderne (convention App Router — voir aussi
// apple-icon.tsx, opengraph-image.tsx, twitter-image.tsx). Source UNIQUE :
// public/amerys-icon.png, déjà utilisé tel quel dans app/dashboard/Header.tsx
// et app/AuthShell.tsx — jamais redessiné, jamais recoloré. Ce PNG a un fond
// transparent et un tracé blanc/quasi-blanc (vérifié pixel par pixel) : sur
// un fond clair (barre d'onglets en thème clair, aperçus sociaux — presque
// toujours blancs), il serait invisible. Composé ici sur `headerBg`
// (#1E1B4B, app/dashboard/format.ts) — exactement le même fond sombre déjà
// utilisé derrière ce logo partout ailleurs dans l'app (Header.tsx,
// AuthShell.tsx), jamais une nouvelle couleur inventée.
const logoSrc = `data:image/png;base64,${readFileSync(join(process.cwd(), 'public/amerys-icon.png')).toString('base64')}`

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rendu par Satori (next/og), pas le navigateur : next/image inutilisable ici. */}
        <img src={logoSrc} width={22} height={19} alt="" />
      </div>
    ),
    { ...size }
  )
}
