// Graphe combiné rendez-vous réels (barres) / montant dépensé (courbe), par
// jour de la période sélectionnée — pendant du OverviewChart.tsx (X = numéro
// de campagne) mais X = date calendaire, pour le filtre de période
// (DashboardDateFilter). Même langage visuel (couleurs, double axe,
// légende) et pas de bascule Totaux/Par jour : la vue est toujours
// quotidienne ici, par construction. SVG fait main (pas de dépendance
// graphique).

import { indigo, ink, line as lineColor, muted, surface, violet } from './format'
import { InfoIcon } from './icons'

export type DailyPoint = { date: string; spend: number; appointments: number }

function barPath(x: number, width: number, top: number, bottom: number, radius: number): string {
  const height = bottom - top
  const r = Math.max(0, Math.min(radius, height / 2, width / 2))
  return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
}

function shortDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  return `${day}/${month}`
}

// Arrondit un maximum brut à un pas "rond" (1/2/5 × 10^n) pour des
// graduations d'axe lisibles — voir OverviewChart.tsx (même logique,
// dupliquée à dessein : composants SVG autonomes, pas de module partagé).
function niceAxisStep(rawMax: number): number {
  if (rawMax <= 0) return 1
  const roughStep = rawMax / 4
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const residual = roughStep / magnitude
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1
  return niceResidual * magnitude
}

export default function OverviewDailyChart({ points }: { points: DailyPoint[] }) {
  const titleRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <h2 style={{ fontWeight: 700, fontSize: 15.5, color: ink, margin: 0 }}>Évolution quotidienne sur la période</h2>
      <InfoIcon size={14} style={{ color: muted }} />
    </div>
  )

  if (points.length === 0) {
    return (
      <div style={{ background: surface, border: `1px solid ${lineColor}`, borderRadius: 18, padding: 22 }}>
        {titleRow}
        <div style={{ padding: '28px 0 6px', textAlign: 'center', color: muted, fontSize: 13.5 }}>
          Aucune donnée journalière sur cette période.
        </div>
      </div>
    )
  }

  const width = 640
  const height = 268
  const marginLeft = 50
  const marginRight = 40
  const marginTop = 14
  const marginBottom = 26
  const plotWidth = width - marginLeft - marginRight
  const plotHeight = height - marginTop - marginBottom
  const baseline = marginTop + plotHeight

  const spendStep = niceAxisStep(Math.max(1, ...points.map((p) => p.spend)))
  const spendAxisMax = spendStep * 4
  const apptStep = niceAxisStep(Math.max(1, ...points.map((p) => p.appointments)))
  const apptAxisMax = apptStep * 4

  const slot = plotWidth / points.length
  const barWidth = Math.min(22, slot * 0.44)

  const yForAppointments = (appointments: number) => baseline - (appointments / apptAxisMax) * plotHeight
  const yForSpend = (spend: number) => baseline - (spend / spendAxisMax) * plotHeight
  const xCenter = (index: number) => marginLeft + slot * index + slot / 2

  const linePoints = points.map((p, i) => `${xCenter(i)},${yForSpend(p.spend)}`).join(' ')
  const fmtSpend = (n: number) => n.toFixed(2).replace('.', ',')
  const fmtSpendAxis = (n: number) => Math.round(n).toLocaleString('fr-FR')
  const fmtAppointments = (n: number) => Math.round(n).toLocaleString('fr-FR')
  const axisLevels = [0, 1, 2, 3, 4]

  // Un point tous les N jours pour l'axe X, afin de ne jamais superposer les
  // libellés sur une période longue (ex. 30 derniers jours) — la donnée reste
  // exacte, seul l'affichage de l'axe est resserré.
  const labelStride = Math.max(1, Math.ceil(points.length / 10))

  return (
    <div style={{ background: surface, border: `1px solid ${lineColor}`, borderRadius: 18, padding: 22 }}>
      {titleRow}
      <p style={{ fontSize: 12, color: muted, margin: '2px 0 14px' }}>
        {points[0].date} → {points[points.length - 1].date}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 12.5, color: muted, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
            <path d="M1 7 L8 4 L14 6 L21 3" fill="none" stroke={indigo} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="14" cy="6" r="2.3" fill={indigo} stroke="#FFFFFF" strokeWidth={1.2} />
          </svg>
          Dépensé (€)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i style={{ width: 11, height: 11, borderRadius: 3.5, background: violet, display: 'inline-block' }} />
          Rendez-vous
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Rendez-vous et dépensé par jour"
      >
        <style>{`
          .ovd-bar, .ovd-dot { transition: opacity .15s ease; }
          .ovd-bar:hover, .ovd-dot:hover { opacity: .72; }
        `}</style>

        {axisLevels.map((lvl) => {
          const y = marginTop + plotHeight * (1 - lvl / 4)
          return (
            <g key={lvl}>
              <line x1={marginLeft} x2={width - marginRight} y1={y} y2={y} stroke={lineColor} strokeWidth={1} />
              <text x={marginLeft - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={muted}>
                {fmtSpendAxis(spendStep * lvl)} €
              </text>
              <text x={width - marginRight + 8} y={y} textAnchor="start" dominantBaseline="middle" fontSize={10} fill={muted}>
                {fmtAppointments(apptStep * lvl)}
              </text>
            </g>
          )
        })}

        {points.map((p, i) => {
          const top = yForAppointments(p.appointments)
          const x = xCenter(i) - barWidth / 2
          return (
            <path key={p.date} className="ovd-bar" d={barPath(x, barWidth, top, baseline, 5)} fill={violet}>
              <title>{`${p.date} — ${fmtAppointments(p.appointments)} rendez-vous`}</title>
            </path>
          )
        })}

        <polyline points={linePoints} fill="none" stroke={indigo} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.date} className="ovd-dot" cx={xCenter(i)} cy={yForSpend(p.spend)} r={3.6} fill={indigo} stroke="#FFFFFF" strokeWidth={2}>
            <title>{`${p.date} — ${fmtSpend(p.spend)} € dépensés`}</title>
          </circle>
        ))}

        {points.map((p, i) =>
          i % labelStride === 0 ? (
            <text key={p.date} x={xCenter(i)} y={height - 7} textAnchor="middle" fontSize={11} fill={muted}>
              {shortDayLabel(p.date)}
            </text>
          ) : null
        )}
      </svg>
    </div>
  )
}
