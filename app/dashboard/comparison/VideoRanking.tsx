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
  // Détail dépliable : une entrée par audience (campagne + Barbier/Coiffeur)
  // de la vue courante, mêmes règles de calcul que la ligne principale.
  occurrences: VideoOccurrenceView[]
}

// Pour un compte client, totalLeads/costPerLead/cplNote arrivent déjà à null
// (retirés côté serveur, voir redactForClient dans page.tsx).
export type VideoOccurrenceView = {
  key: string
  campaignNumber: number | null
  audienceType: 'barbier' | 'coiffeur'
  totalLeads: number | null
  costPerLead: number | null
  cplNote: RankedVideo['cplNote']
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: 12, color: muted, whiteSpace: 'nowrap' }}>
      {label} <b style={{ color: ink, fontWeight: 600 }}>{value}</b>
    </span>
  )
}

// Détail campagne par campagne (occurrences déjà filtrées par audience côté
// serveur). Valeur absente -> « — », jamais une valeur inventée. Leads et
// coût/lead affichés pour l'admin uniquement, comme sur la ligne principale.
function OccurrenceList({ occurrences, isAdmin }: { occurrences: VideoOccurrenceView[]; isAdmin: boolean }) {
  const pct = (n: number | null) => (n === null ? '—' : formatPctValue(n))
  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted, margin: '0 0 6px' }}>
        Détail par campagne
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {occurrences.map((o) => (
          <li
            key={o.key}
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 14, rowGap: 4, padding: '7px 10px', borderRadius: 10, background: surfaceAlt }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 150 }}>
              {o.campaignNumber === null ? 'Campagne —' : `Campagne n°${o.campaignNumber}`}{' '}
              <span style={{ color: audienceColor(o.audienceType) }}>· {o.audienceType === 'barbier' ? 'Barbier' : 'Coiffeur'}</span>
            </span>
            <Metric label="Accroche" value={pct(o.hookPlay)} />
            <Metric label="Rétention" value={pct(o.retentionRate)} />
            {isAdmin ? <Metric label="Leads Meta" value={o.totalLeads === null ? '—' : String(o.totalLeads)} /> : null}
            {isAdmin ? (
              <Metric
                label="Coût/lead"
                value={o.cplNote === 'shared_audience' ? 'Non comparable' : o.costPerLead === null ? '—' : formatCostValue(o.costPerLead)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

// Ligne du classement dépliable : toute la ligne est un <button>
// (clavier : Tab + Entrée/Espace natifs), aria-expanded/aria-controls pour
// les lecteurs d'écran. Mise en forme de la ligne inchangée (même grille).
function VideoCard({
  video,
  rank,
  rankColor,
  nameColor,
  right,
  dashed,
  open,
  onToggle,
  isAdmin,
  context,
}: {
  video: RankedVideo
  rank: string
  rankColor: string
  nameColor: string
  right: React.ReactNode
  dashed: boolean
  open: boolean
  onToggle: () => void
  isAdmin: boolean
  context: string
}) {
  const detailId = `video-detail-${encodeURIComponent(video.identityKey)}`
  return (
    <div
      style={{
        background: dashed ? surfaceAlt : surface,
        border: `1px ${dashed ? 'dashed' : 'solid'} ${line}`,
        borderRadius: radius,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '26px 1fr auto',
          gap: 14,
          alignItems: 'center',
          width: '100%',
          padding: '13px 16px',
          border: 0,
          background: 'transparent',
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        {/* span (pas div) : un <button> n'accepte que du contenu « phrasing ». */}
        <span
          style={{
            display: 'block',
            fontWeight: rank === '—' ? undefined : 700,
            fontSize: rank === '—' ? undefined : 17,
            color: rankColor,
            textAlign: 'center',
          }}
        >
          {rank}
        </span>
        <span style={{ display: 'block' }}>
          <b style={{ fontSize: 14, display: 'block', color: nameColor }}>{video.displayName}</b>
          <span style={{ fontSize: 12, color: muted }}>{context}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'block', textAlign: 'right' }}>{right}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
            style={{ color: muted, flexShrink: 0, transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open ? (
        <div id={detailId} style={{ borderTop: `1px solid ${line}`, padding: '10px 16px 14px' }}>
          <OccurrenceList occurrences={video.occurrences} isAdmin={isAdmin} />
        </div>
      ) : null}
    </div>
  )
}

export default function VideoRanking({ videos: videosByAudience, isAdmin }: { videos: RankedVideosByAudience; isAdmin: boolean }) {
  const [audience, setAudience] = useState<AudienceFilter>('all')
  const videos = videosByAudience[audience]
  // Vidéos dépliées (par identityKey) : conservées en changeant de filtre,
  // le détail affichant alors les occurrences de la nouvelle vue.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
            <VideoCard
              key={v.identityKey}
              video={v}
              rank={String(i + 1)}
              rankColor={i === 0 ? accent : muted}
              nameColor={audienceColor(v.audienceType)}
              dashed={false}
              open={openKeys.has(v.identityKey)}
              onToggle={() => toggle(v.identityKey)}
              isAdmin={isAdmin}
              context={contextOf(v)}
              right={
                <>
                  <b style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 19 }}>{formatMetric(v)}</b>
                  <span style={{ fontSize: 11, color: muted, display: 'block' }}>{CRITERION_LABELS[criterion]}</span>
                </>
              }
            />
          ))}

          {unranked.length > 0 ? (
            <div style={{ marginTop: 6 }}>
              <p style={{ color: muted, fontSize: 12, marginBottom: 8 }}>
                {unranked.length} vidéo{unranked.length > 1 ? 's' : ''} non classable
                {unranked.length > 1 ? 's' : ''} (métrique non disponible ou non comparable) :
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {unranked.map((v) => (
                  <VideoCard
                    key={v.identityKey}
                    video={v}
                    rank="—"
                    rankColor={muted}
                    nameColor={ink}
                    dashed
                    open={openKeys.has(v.identityKey)}
                    onToggle={() => toggle(v.identityKey)}
                    isAdmin={isAdmin}
                    context={contextOf(v)}
                    right={<span style={{ color: muted, fontSize: 12.5 }}>{unavailableLabel(v)}</span>}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
