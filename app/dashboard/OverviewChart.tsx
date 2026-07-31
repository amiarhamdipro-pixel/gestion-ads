// Graphe combiné leads Meta (barres) / montant dépensé (courbe), style repris
// de dashboard-maquette_1.html sans copier sa feuille de style. SVG fait main
// (pas de dépendance graphique dans le projet — la maquette utilisait Chart.js
// via un <script> CDN, jamais installé comme dépendance npm).

import { campaignDurationDays, metaPixelLeadsPerDay, spendPerDay } from '@/lib/calculations'

const ink = '#16172E'
const muted = '#71748C'
const faint = '#9A9DB2'
const line = '#E4E7F0'
const accent = '#4A38D1'
const spendColor = '#E28234'

export type OverviewMode = 'total' | 'day'

type ChartCampaign = {
  campaign_number: number
  start_date: string | null
  end_date: string | null
  meta_spend: number
  meta_pixel_leads: number
}

type ChartPoint = { campaign_number: number; leads: number; spend: number }

function barPath(x: number, width: number, top: number, bottom: number, radius: number): string {
  const height = bottom - top
  const r = Math.max(0, Math.min(radius, height / 2, width / 2))
  return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
}

export default function OverviewChart({
  campaigns,
  mode = 'total',
}: {
  campaigns: ChartCampaign[]
  mode?: OverviewMode
}) {
  const points: ChartPoint[] = []
  for (const c of campaigns) {
    if (mode === 'total') {
      points.push({ campaign_number: c.campaign_number, leads: c.meta_pixel_leads, spend: c.meta_spend })
      continue
    }
    const duration = campaignDurationDays(c.start_date, c.end_date)
    const leads = metaPixelLeadsPerDay(c.meta_pixel_leads, duration)
    const spend = spendPerDay(c.meta_spend, duration)
    if (leads === null || spend === null) continue
    points.push({ campaign_number: c.campaign_number, leads, spend })
  }

  if (points.length === 0) {
    return (
      <div
        style={{
          background: '#FFFFFF',
          border: `1px solid ${line}`,
          borderRadius: 16,
          padding: 32,
          textAlign: 'center',
          color: muted,
          fontSize: 13.5,
        }}
      >
        {mode === 'day' && campaigns.length > 0
          ? 'Aucune campagne avec une durée connue (date de fin non renseignée).'
          : 'Aucune campagne à afficher pour le moment.'}
      </div>
    )
  }

  const leadsLabel = mode === 'day' ? 'Leads Meta / jour' : 'Leads Meta (pixel)'
  const spendLabel = mode === 'day' ? 'Dépensé / jour' : 'Montant dépensé'

  const width = 640
  const height = 260
  const marginLeft = 34
  const marginRight = 40
  const marginTop = 12
  const marginBottom = 28
  const plotWidth = width - marginLeft - marginRight
  const plotHeight = height - marginTop - marginBottom
  const baseline = marginTop + plotHeight

  const maxLeads = Math.max(1, ...points.map((p) => p.leads))
  const maxSpend = Math.max(1, ...points.map((p) => p.spend))

  const slot = plotWidth / points.length
  const barWidth = Math.min(24, slot * 0.5)

  const yForLeads = (leads: number) => baseline - (leads / maxLeads) * plotHeight
  const yForSpend = (spend: number) => baseline - (spend / maxSpend) * plotHeight
  const xCenter = (index: number) => marginLeft + slot * index + slot / 2

  const linePoints = points.map((p, i) => `${xCenter(i)},${yForSpend(p.spend)}`).join(' ')
  const gridTicks = [0, 0.25, 0.5, 0.75, 1]
  const fmtSpend = (n: number) => n.toFixed(2).replace('.', ',')
  const fmtSpendAxis = (n: number) =>
    mode === 'day' ? n.toFixed(2).replace('.', ',') : Math.round(n).toLocaleString('fr-FR')
  const fmtLeads = (n: number) =>
    mode === 'day' ? n.toFixed(2).replace('.', ',') : Math.round(n).toLocaleString('fr-FR')

  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${line}`, borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', gap: 16, fontSize: 12.5, color: muted, marginBottom: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i style={{ width: 12, height: 12, borderRadius: 4, background: accent, display: 'inline-block' }} />
          {leadsLabel}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i style={{ width: 16, height: 3, borderRadius: 2, background: spendColor, display: 'inline-block' }} />
          {spendLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`${leadsLabel} et ${spendLabel.toLowerCase()} par campagne`}
      >
        {gridTicks.map((t) => (
          <line
            key={t}
            x1={marginLeft}
            x2={width - marginRight}
            y1={marginTop + plotHeight * (1 - t)}
            y2={marginTop + plotHeight * (1 - t)}
            stroke={line}
            strokeWidth={1}
          />
        ))}

        {points.map((p, i) => {
          const top = yForLeads(p.leads)
          const x = xCenter(i) - barWidth / 2
          return (
            <path key={p.campaign_number} d={barPath(x, barWidth, top, baseline, 4)} fill={accent}>
              <title>{`Campagne ${p.campaign_number} — ${fmtLeads(p.leads)} lead(s) Meta${mode === 'day' ? ' / jour' : ''}`}</title>
            </path>
          )
        })}

        <polyline
          points={linePoints}
          fill="none"
          stroke={spendColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle
            key={p.campaign_number}
            cx={xCenter(i)}
            cy={yForSpend(p.spend)}
            r={4}
            fill={spendColor}
            stroke="#FFFFFF"
            strokeWidth={2}
          >
            <title>{`Campagne ${p.campaign_number} — ${fmtSpend(p.spend)} € dépensés${mode === 'day' ? ' / jour' : ''}`}</title>
          </circle>
        ))}

        {points.map((p, i) => (
          <text key={p.campaign_number} x={xCenter(i)} y={height - 8} textAnchor="middle" fontSize={11.5} fill={ink}>
            {p.campaign_number}
          </text>
        ))}

        <text x={marginLeft} y={marginTop - 2} fontSize={10.5} fill={faint}>
          {fmtLeads(maxLeads)} leads
        </text>
        <text x={width - marginRight} y={marginTop - 2} fontSize={10.5} fill={faint} textAnchor="end">
          {fmtSpendAxis(maxSpend)} €
        </text>
      </svg>
    </div>
  )
}
