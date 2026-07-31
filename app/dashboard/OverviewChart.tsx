// Graphe combiné leads Meta (barres) / montant dépensé (courbe), style repris
// de dashboard-maquette_1.html sans copier sa feuille de style. SVG fait main
// (pas de dépendance graphique dans le projet — la maquette utilisait Chart.js
// via un <script> CDN, jamais installé comme dépendance npm).

const ink = '#16172E'
const muted = '#71748C'
const faint = '#9A9DB2'
const line = '#E4E7F0'
const accent = '#4A38D1'
const spendColor = '#E28234'

type ChartCampaign = {
  campaign_number: number
  meta_spend: number
  meta_pixel_leads: number
}

function barPath(x: number, width: number, top: number, bottom: number, radius: number): string {
  const height = bottom - top
  const r = Math.max(0, Math.min(radius, height / 2, width / 2))
  return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
}

export default function OverviewChart({ campaigns }: { campaigns: ChartCampaign[] }) {
  if (campaigns.length === 0) {
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
        Aucune campagne à afficher pour le moment.
      </div>
    )
  }

  const width = 640
  const height = 260
  const marginLeft = 34
  const marginRight = 40
  const marginTop = 12
  const marginBottom = 28
  const plotWidth = width - marginLeft - marginRight
  const plotHeight = height - marginTop - marginBottom
  const baseline = marginTop + plotHeight

  const maxLeads = Math.max(1, ...campaigns.map((c) => c.meta_pixel_leads))
  const maxSpend = Math.max(1, ...campaigns.map((c) => c.meta_spend))

  const slot = plotWidth / campaigns.length
  const barWidth = Math.min(24, slot * 0.5)

  const yForLeads = (leads: number) => baseline - (leads / maxLeads) * plotHeight
  const yForSpend = (spend: number) => baseline - (spend / maxSpend) * plotHeight
  const xCenter = (index: number) => marginLeft + slot * index + slot / 2

  const linePoints = campaigns.map((c, i) => `${xCenter(i)},${yForSpend(c.meta_spend)}`).join(' ')
  const gridTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${line}`, borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', gap: 16, fontSize: 12.5, color: muted, marginBottom: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i style={{ width: 12, height: 12, borderRadius: 4, background: accent, display: 'inline-block' }} />
          Leads Meta (pixel)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i style={{ width: 16, height: 3, borderRadius: 2, background: spendColor, display: 'inline-block' }} />
          Montant dépensé
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Leads Meta et montant dépensé par campagne">
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

        {campaigns.map((c, i) => {
          const top = yForLeads(c.meta_pixel_leads)
          const x = xCenter(i) - barWidth / 2
          return (
            <path key={c.campaign_number} d={barPath(x, barWidth, top, baseline, 4)} fill={accent}>
              <title>{`Campagne ${c.campaign_number} — ${c.meta_pixel_leads} lead(s) Meta`}</title>
            </path>
          )
        })}

        <polyline points={linePoints} fill="none" stroke={spendColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {campaigns.map((c, i) => (
          <circle key={c.campaign_number} cx={xCenter(i)} cy={yForSpend(c.meta_spend)} r={4} fill={spendColor} stroke="#FFFFFF" strokeWidth={2}>
            <title>{`Campagne ${c.campaign_number} — ${c.meta_spend.toFixed(2).replace('.', ',')} € dépensés`}</title>
          </circle>
        ))}

        {campaigns.map((c, i) => (
          <text
            key={c.campaign_number}
            x={xCenter(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize={11.5}
            fill={ink}
          >
            {c.campaign_number}
          </text>
        ))}

        <text x={marginLeft} y={marginTop - 2} fontSize={10.5} fill={faint}>
          {maxLeads} leads
        </text>
        <text x={width - marginRight} y={marginTop - 2} fontSize={10.5} fill={faint} textAnchor="end">
          {Math.round(maxSpend).toLocaleString('fr-FR')} €
        </text>
      </svg>
    </div>
  )
}
