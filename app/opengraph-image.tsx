import { ImageResponse } from 'next/og'
import { BRAND_NAME } from './brand'
import { brandIconDataUri } from './brand-image'

// Aperçu de partage de lien (WhatsApp, iMessage, LinkedIn, Facebook...).
// Symbole officiel du kit Amerys (public/brand/amerys-icone.png, voir
// app/brand.ts) — badge circulaire autonome, jamais redessiné/recoloré.
// Couleurs de la charte (thème nuit, valeurs en dur : Satori ne lit pas les
// variables CSS) : fond #09070E, halo violet diffus, textes #F5F0F8 /
// #DDD2E2. Nom affiché : "AMERYS ADS", comme dans Header.tsx.
const iconSrc = brandIconDataUri()

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
        {/* eslint-disable-next-line @next/next/no-img-element -- rendu par Satori (next/og), pas le navigateur. */}
        <img src={iconSrc} width={170} height={170} alt="" />
        <div style={{ marginTop: 36, fontSize: 60, fontWeight: 600, color: '#F5F0F8', letterSpacing: '0.02em' }}>
          {BRAND_NAME}
        </div>
        <div style={{ marginTop: 14, fontSize: 28, color: '#DDD2E2' }}>
          Suivi des campagnes publicitaires
        </div>
      </div>
    ),
    { ...size }
  )
}
