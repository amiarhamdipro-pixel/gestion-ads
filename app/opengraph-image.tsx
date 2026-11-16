import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// Aperçu de partage de lien (WhatsApp, iMessage, LinkedIn, Facebook...).
// Même source unique que icon.tsx/apple-icon.tsx (public/amerys-icon.png :
// symbole officiel Amerys Agency, identique au fichier du dépôt AmerysAgency,
// jamais redessiné/recoloré). Couleurs de la charte (thème nuit, valeurs en
// dur : Satori ne lit pas les variables CSS) : fond #09070E, halo violet
// diffus, symbole dans un cercle, textes #F5F0F8 / #DDD2E2. Nom affiché :
// "AMERYS ADS", comme dans Header.tsx.
const logoSrc = `data:image/png;base64,${readFileSync(join(process.cwd(), 'public/amerys-icon.png')).toString('base64')}`

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#09070E',
          backgroundImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(155, 102, 186, 0.22) 0%, rgba(9, 7, 14, 0) 70%)',
        }}
      >
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: 80,
            background: '#100B16',
            border: '2px solid rgba(255, 255, 255, 0.094)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- rendu par Satori (next/og), pas le navigateur. */}
          <img src={logoSrc} width={100} height={86} alt="" />
        </div>
        <div style={{ marginTop: 40, fontSize: 60, fontWeight: 600, color: '#F5F0F8', letterSpacing: '0.02em' }}>
          AMERYS ADS
        </div>
        <div style={{ marginTop: 14, fontSize: 28, color: '#DDD2E2' }}>
          Suivi des campagnes publicitaires
        </div>
      </div>
    ),
    { ...size }
  )
}
