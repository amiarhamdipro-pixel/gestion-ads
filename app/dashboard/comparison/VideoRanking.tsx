'use client'

import { useState } from 'react'
import { accent, ink, line, muted, radius, surface, surfaceAlt, violet } from '../format'

export type RankedVideo = {
  metaAdId: string
  name: string
  videoDisplayName: string | null
  campaignCount: number
  audienceType: 'barbier' | 'coiffeur'
  costPerLead: number | null
  hookPlay: number | null
}

type Criterion = 'cpl' | 'hook'

function formatCostValue(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €'
}

function formatPctValue(n: number): string {
  return `${(n * 100).toFixed(1).replace('.', ',')} %`
}

// Même priorité d'affichage que le détail campagne (voir
// BRIEF-CLAUDE-CODE.md) : nom réel du fichier importé dans Meta -> nom de la
// pub Ads Manager -> repli générique. Jamais d'erreur, jamais de placeholder
// technique.
function videoDisplayName(video: RankedVideo): string {
  return video.videoDisplayName?.trim() || video.name.trim() || 'Vidéo'
}

export default function VideoRanking({ videos }: { videos: RankedVideo[] }) {
  const [criterion, setCriterion] = useState<Criterion>('cpl')

  const metricOf = (v: RankedVideo) => (criterion === 'cpl' ? v.costPerLead : v.hookPlay)
  const ranked = videos.filter((v) => metricOf(v) !== null)
  const unranked = videos.filter((v) => metricOf(v) === null)

  ranked.sort((a, b) => {
    const ma = metricOf(a) as number
    const mb = metricOf(b) as number
    return criterion === 'cpl' ? ma - mb : mb - ma
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>Classement des vidéos</h2>
          <p style={{ color: muted, fontSize: 12.5, margin: '2px 0 0' }}>
            {videos.length} vidéo{videos.length > 1 ? 's' : ''} — une vidéo peut revenir sur plusieurs campagnes
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, background: surfaceAlt, border: `1px solid ${line}`, borderRadius: 999, padding: 3 }}>
          {(
            [
              { key: 'cpl', label: 'Meilleur coût par lead' },
              { key: 'hook', label: "Meilleur taux d'accroche" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setCriterion(opt.key)}
              style={{
                border: 0,
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 12,
                cursor: 'pointer',
                background: criterion === opt.key ? surface : 'transparent',
                fontWeight: criterion === opt.key ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {videos.length === 0 ? (
        <p style={{ color: muted, fontSize: 13.5 }}>Aucune vidéo à classer pour le moment.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ranked.map((v, i) => (
            <div
              key={v.metaAdId}
              style={{
                display: 'grid',
                gridTemplateColumns: '26px 1fr auto',
                gap: 14,
                alignItems: 'center',
                background: surface,
                border: `1px solid ${line}`,
                borderRadius: radius,
                padding: '13px 16px',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 17, color: i === 0 ? accent : muted, textAlign: 'center' }}>
                {i + 1}
              </div>
              <div>
                <b style={{ fontSize: 14, display: 'block', color: v.audienceType === 'barbier' ? accent : violet }}>
                  {videoDisplayName(v)}
                </b>
                <span style={{ fontSize: 12, color: muted }}>
                  diffusée sur {v.campaignCount} campagne{v.campaignCount > 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <b style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 19 }}>
                  {criterion === 'cpl' ? formatCostValue(v.costPerLead as number) : formatPctValue(v.hookPlay as number)}
                </b>
                <span style={{ fontSize: 11, color: muted, display: 'block' }}>
                  {criterion === 'cpl' ? 'coût par lead' : "taux d'accroche"}
                </span>
              </div>
            </div>
          ))}

          {unranked.length > 0 ? (
            <div style={{ marginTop: 6 }}>
              <p style={{ color: muted, fontSize: 12, marginBottom: 8 }}>
                {unranked.length} vidéo{unranked.length > 1 ? 's' : ''} non classable
                {unranked.length > 1 ? 's' : ''} (métrique non calculable — division par zéro évitée) :
              </p>
              {unranked.map((v) => (
                <div
                  key={v.metaAdId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '26px 1fr auto',
                    gap: 14,
                    alignItems: 'center',
                    background: surfaceAlt,
                    border: `1px dashed ${line}`,
                    borderRadius: radius,
                    padding: '13px 16px',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ textAlign: 'center', color: muted }}>—</div>
                  <div>
                    <b style={{ fontSize: 14, display: 'block', color: ink }}>{videoDisplayName(v)}</b>
                    <span style={{ fontSize: 12, color: muted }}>
                      diffusée sur {v.campaignCount} campagne{v.campaignCount > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right', color: muted, fontSize: 12.5 }}>Non disponible</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
