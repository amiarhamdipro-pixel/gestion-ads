'use client'

import { useState } from 'react'
import { accent, ink, line, muted, radius, surface, surfaceAlt, violet } from '../format'

// displayName est déjà résolu côté serveur (voir computeRankedVideos dans
// page.tsx : video_display_name -> name -> repli générique, nom exact
// conservé, extension .mp4 incluse) — ce composant ne refait aucune
// résolution de nom, il affiche tel quel. identityKey (nom normalisé —
// trim + casse insensible) sert uniquement de clé React, une ligne = une
// créative unique, déjà dédupliquée en amont.
export type RankedVideo = {
  identityKey: string
  displayName: string
  campaignCount: number
  // 'both' : vidéo diffusée aux deux audiences (vue « Toutes » uniquement).
  audienceType: 'barbier' | 'coiffeur' | 'both'
  // Leads Meta cumulés des audiences attribuées à la vidéo ; null si une
  // audience est partagée avec d'autres vidéos (non attribuable).
  totalLeads: number | null
  costPerLead: number | null
  // Raison d'un coût/lead indisponible (null = calculé).
  cplNote: 'shared_audience' | 'no_leads' | 'no_spend' | null
  hookPlay: number | null
  retentionRate: number | null
}

export type AudienceFilter = 'all' | 'barbier' | 'coiffeur'

// Trois vues calculées côté serveur (filtre appliqué aux occurrences AVANT le
// regroupement, voir computeRankedVideos dans page.tsx).
export type RankedVideosByAudience = Record<AudienceFilter, RankedVideo[]>

type Criterion = 'cpl' | 'hook' | 'retention'

const AUDIENCE_OPTIONS: { key: AudienceFilter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'barbier', label: 'Barbier' },
  { key: 'coiffeur', label: 'Coiffeur' },
]

const CPL_NOTE_LABEL: Record<NonNullable<RankedVideo['cplNote']>, string> = {
  shared_audience: 'Non comparable (audience partagée)',
  no_leads: 'Aucun lead Meta',
  no_spend: 'Dépenses non renseignées',
}

function audienceColor(type: RankedVideo['audienceType']): string {
  return type === 'barbier' ? accent : type === 'coiffeur' ? violet : ink
}

function formatCostValue(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €'
}

function formatPctValue(n: number): string {
  return `${(n * 100).toFixed(1).replace('.', ',')} %`
}

const CRITERION_LABELS: Record<Criterion, string> = {
  cpl: 'coût par lead',
  hook: "taux d'accroche",
  retention: 'taux de rétention',
}

function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 3, background: surfaceAlt, border: `1px solid ${line}`, borderRadius: 999, padding: 3 }}>
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={value === opt.key}
          onClick={() => onChange(opt.key)}
          style={{
            border: 0,
            borderRadius: 999,
            padding: '5px 12px',
            fontSize: 12,
            cursor: 'pointer',
            background: value === opt.key ? surface : 'transparent',
            fontWeight: value === opt.key ? 600 : 400,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function VideoRanking({ videos: videosByAudience, isAdmin }: { videos: RankedVideosByAudience; isAdmin: boolean }) {
  const [audience, setAudience] = useState<AudienceFilter>('all')
  const videos = videosByAudience[audience]
  // Coût par lead masqué pour un compte client (voir BRIEF-CLAUDE-CODE.md,
  // même règle que "Leads Meta"/"Coût par Lead Meta" ailleurs sur le
  // dashboard) : le critère ne doit jamais pouvoir valoir 'cpl' hors admin.
  // Accroche et rétention restent visibles pour les deux rôles.
  const [criterion, setCriterion] = useState<Criterion>(isAdmin ? 'cpl' : 'hook')

  const options = (
    [
      ...(isAdmin ? [{ key: 'cpl' as const, label: 'Meilleur coût par lead' }] : []),
      { key: 'hook' as const, label: "Meilleur taux d'accroche" },
      { key: 'retention' as const, label: 'Meilleur taux de rétention' },
    ] as const
  )

  const metricOf = (v: RankedVideo) =>
    criterion === 'cpl' ? v.costPerLead : criterion === 'hook' ? v.hookPlay : v.retentionRate
  const ranked = videos.filter((v) => metricOf(v) !== null)
  const unranked = videos.filter((v) => metricOf(v) === null)

  // Coût/lead : plus bas est meilleur (croissant). Accroche/rétention : plus
  // haut est meilleur (décroissant).
  ranked.sort((a, b) => {
    const ma = metricOf(a) as number
    const mb = metricOf(b) as number
    return criterion === 'cpl' ? ma - mb : mb - ma
  })

  const formatMetric = (v: RankedVideo) => {
    if (criterion === 'cpl') return formatCostValue(v.costPerLead as number)
    return formatPctValue((criterion === 'hook' ? v.hookPlay : v.retentionRate) as number)
  }

  // Contexte sous le nom : campagnes pour tous ; leads Meta pour l'admin
  // uniquement (même règle que le coût/lead, masqué pour un compte client).
  const contextOf = (v: RankedVideo) =>
    `Utilisée sur ${v.campaignCount} campagne${v.campaignCount > 1 ? 's' : ''}` +
    (isAdmin
      ? v.totalLeads === null
        ? ' · leads non attribuables'
        : ` · ${v.totalLeads} lead${v.totalLeads > 1 ? 's' : ''} Meta`
      : '')

  const unavailableLabel = (v: RankedVideo) => (criterion === 'cpl' && v.cplNote ? CPL_NOTE_LABEL[v.cplNote] : 'Non disponible')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>Classement des vidéos</h2>
          <p style={{ color: muted, fontSize: 12.5, margin: '2px 0 0' }}>
            Toutes périodes · {videos.length} vidéo{videos.length > 1 ? 's' : ''} — une vidéo peut revenir sur plusieurs campagnes
          </p>
          {isAdmin ? (
            <p style={{ color: muted, fontSize: 11.5, margin: '2px 0 0' }}>
              Coût/lead calculé à partir des données Meta de l’audience : dépenses cumulées ÷ leads Meta cumulés.
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <SegmentedControl options={AUDIENCE_OPTIONS} value={audience} onChange={setAudience} label="Audience" />
          <SegmentedControl options={options} value={criterion} onChange={setCriterion} label="Critère de classement" />
        </div>
      </div>

      {videos.length === 0 ? (
        <p style={{ color: muted, fontSize: 13.5 }}>
          {audience === 'all' ? 'Aucune vidéo à classer pour le moment.' : 'Aucune vidéo pour cette audience.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ranked.map((v, i) => (
            <div
              key={v.identityKey}
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
                <b style={{ fontSize: 14, display: 'block', color: audienceColor(v.audienceType) }}>
                  {v.displayName}
                </b>
                <span style={{ fontSize: 12, color: muted }}>{contextOf(v)}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <b style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 19 }}>{formatMetric(v)}</b>
                <span style={{ fontSize: 11, color: muted, display: 'block' }}>{CRITERION_LABELS[criterion]}</span>
              </div>
            </div>
          ))}

          {unranked.length > 0 ? (
            <div style={{ marginTop: 6 }}>
              <p style={{ color: muted, fontSize: 12, marginBottom: 8 }}>
                {unranked.length} vidéo{unranked.length > 1 ? 's' : ''} non classable
                {unranked.length > 1 ? 's' : ''} (métrique non disponible ou non comparable) :
              </p>
              {unranked.map((v) => (
                <div
                  key={v.identityKey}
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
                    <b style={{ fontSize: 14, display: 'block', color: ink }}>{v.displayName}</b>
                    <span style={{ fontSize: 12, color: muted }}>{contextOf(v)}</span>
                  </div>
                  <div style={{ textAlign: 'right', color: muted, fontSize: 12.5 }}>{unavailableLabel(v)}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
