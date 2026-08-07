import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// Aperçu de partage de lien (WhatsApp, iMessage, LinkedIn, Facebook...).
// Même source unique que icon.tsx/apple-icon.tsx (public/amerys-icon.png,
// jamais redessiné/recoloré), même fond `headerBg` (#1E1B4B) et mêmes
// couleurs de texte (`onDark`/`onDarkMuted`) que app/dashboard/format.ts —
// reprend exactement l'habillage déjà utilisé dans le bandeau du dashboard
// (Header.tsx : "AMERYS AGENCY – ADS" / "Marketing Dashboard"), jamais un
// nouveau texte ou une nouvelle identité inventée pour cette seule image.
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
          background: '#1E1B4B',
        }}
      >
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: 28,
            background: 'rgba(255, 255, 255, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- rendu par Satori (next/og), pas le navigateur. */}
          <img src={logoSrc} width={100} height={86} alt="" />
        </div>
        <div style={{ marginTop: 40, fontSize: 56, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
          AMERYS AGENCY – ADS
        </div>
        <div style={{ marginTop: 14, fontSize: 28, color: 'rgba(255, 255, 255, 0.62)' }}>
          Suivi des campagnes publicitaires
        </div>
      </div>
    ),
    { ...size }
  )
}
