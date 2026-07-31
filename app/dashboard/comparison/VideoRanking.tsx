'use client'

import { useState } from 'react'
import { accent, faint, ink, line, muted, surface } from '../format'

const teal = '#0E9AA7'

export type RankedVideo = {
  metaAdId: string
  name: string
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
      <div style={{ display: 'flex', gap: 3, background: '#F6F7FB', border: `1px solid ${line}`, borderRadius: 999, padding: 3, width: 'fit-content', marginBottom: 16 }}>
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
              padding: '6px 13px',
              fontSize: 12.5,
              cursor: 'pointer',
              background: criterion === opt.key ? surface : 'transparent',
              fontWeight: criterion === opt.key ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        ))}
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
                borderRadius: 14,
                padding: '12px 16px',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 17, color: i === 0 ? accent : faint, textAlign: 'center' }}>
                {i + 1}
              </div>
              <div>
                <b style={{ fontSize: 14, display: 'block', color: v.audienceType === 'barbier' ? accent : teal }}>
                  {v.name}
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
              <p style={{ color: faint, fontSize: 12, marginBottom: 8 }}>
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
                    background: '#F6F7FB',
                    border: `1px dashed ${line}`,
                    borderRadius: 14,
                    padding: '12px 16px',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ textAlign: 'center', color: faint }}>—</div>
                  <div>
                    <b style={{ fontSize: 14, display: 'block', color: ink }}>{v.name}</b>
                    <span style={{ fontSize: 12, color: muted }}>
                      diffusée sur {v.campaignCount} campagne{v.campaignCount > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right', color: faint, fontSize: 12.5 }}>Non disponible</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
