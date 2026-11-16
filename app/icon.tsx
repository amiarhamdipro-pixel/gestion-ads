import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// Icône d'onglet / favicon moderne (convention App Router — voir aussi
// apple-icon.tsx, opengraph-image.tsx, twitter-image.tsx). Source UNIQUE :
// public/amerys-icon.png, déjà utilisé tel quel dans app/dashboard/Header.tsx
// et app/AuthShell.tsx — jamais redessiné, jamais recoloré. Ce PNG a un fond
// transparent et un tracé blanc/quasi-blanc (vérifié pixel par pixel) : sur
// un fond clair (barre d'onglets en thème clair, aperçus sociaux — presque
// toujours blancs), il serait invisible. Composé ici sur un dégradé des
// violets de la charte Amerys (#9560B4 -> #24142D) : lisible sur une barre
// d'onglets claire comme sombre, aucune couleur hors charte. Symbole officiel
// Amerys Agency (identique au fichier du dépôt AmerysAgency).
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
          backgroundImage: 'linear-gradient(135deg, #9560B4 0%, #24142D 100%)',
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
