// Graphe combiné rendez-vous réels (barres) / montant dépensé (courbe), par
// jour de la période sélectionnée — pendant du OverviewChart.tsx (X = numéro
// de campagne) mais X = date calendaire, pour le filtre de période
// (DashboardDateFilter). Même langage visuel (couleurs, mini-légende
// dépensé), pas de bascule Totaux/Par jour : la vue est toujours quotidienne
// ici, par construction. SVG fait main (pas de dépendance graphique).

import { faint, indigo, ink, line as lineColor, muted, surface, violet } from './format'
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

export default function OverviewDailyChart({ points }: { points: DailyPoint[] }) {
  const titleRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <h2 style={{ fontWeight: 700, fontSize: 15.5, color: ink, margin: 0 }}>Évolution quotidienne sur la période</h2>
      <InfoIcon size={14} style={{ color: faint }} />
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

  const hasAppointments = points.some((p) => p.appointments > 0)

  const width = 640
  const height = 250
  const marginLeft = 36
  const marginRight = 42
  const marginTop = 14
  const marginBottom = 26
  const plotWidth = width - marginLeft - marginRight
  const plotHeight = height - marginTop - marginBottom
  const baseline = marginTop + plotHeight

  const maxAppointments = Math.max(1, ...points.map((p) => p.appointments))
  const maxSpend = Math.max(1, ...points.map((p) => p.spend))

  const slot = plotWidth / points.length
  const barWidth = Math.min(22, slot * 0.44)

  const yForAppointments = (appointments: number) => baseline - (appointments / maxAppointments) * plotHeight
  const yForSpend = (spend: number) => baseline - (spend / maxSpend) * plotHeight
  const xCenter = (index: number) => marginLeft + slot * index + slot / 2

  const linePoints = points.map((p, i) => `${xCenter(i)},${yForSpend(p.spend)}`).join(' ')
  const fmtSpend = (n: number) => n.toFixed(2).replace('.', ',')
  const fmtSpendAxis = (n: number) => Math.round(n).toLocaleString('fr-FR')
  const fmtAppointments = (n: number) => Math.round(n).toLocaleString('fr-FR')

  // Un point tous les N jours pour l'axe X, afin de ne jamais superposer les
  // libellés sur une période longue (ex. 30 derniers jours) — la donnée reste
  // exacte, seul l'affichage de l'axe est resserré.
  const labelStride = Math.max(1, Math.ceil(points.length / 10))

  return (
    <div style={{ background: surface, border: `1px solid ${lineColor}`, borderRadius: 18, padding: 22 }}>
      {titleRow}
      <p style={{ fontSize: 12, color: faint, margin: '2px 0 14px' }}>
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
        {hasAppointments ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <i style={{ width: 11, height: 11, borderRadius: 3.5, background: violet, display: 'inline-block' }} />
            Rendez-vous
          </span>
        ) : (
          <span style={{ fontSize: 12, color: faint }}>Aucun rendez-vous sur cette période</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={hasAppointments ? 'Rendez-vous et dépensé par jour' : 'Dépensé par jour — aucun rendez-vous sur cette période'}
      >
        <style>{`
          .ovd-bar, .ovd-dot { transition: opacity .15s ease; }
          .ovd-bar:hover, .ovd-dot:hover { opacity: .72; }
        `}</style>

        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={marginLeft}
            x2={width - marginRight}
            y1={marginTop + plotHeight * (1 - t)}
            y2={marginTop + plotHeight * (1 - t)}
            stroke={lineColor}
            strokeWidth={1}
          />
        ))}

        {hasAppointments
          ? points.map((p, i) => {
              const top = yForAppointments(p.appointments)
              const x = xCenter(i) - barWidth / 2
              return (
                <path key={p.date} className="ovd-bar" d={barPath(x, barWidth, top, baseline, 5)} fill={violet}>
                  <title>{`${p.date} — ${fmtAppointments(p.appointments)} rendez-vous`}</title>
                </path>
              )
            })
          : null}

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

        {hasAppointments ? (
          <text x={marginLeft} y={marginTop - 3} fontSize={10} fill={faint}>
            {fmtAppointments(maxAppointments)} RDV
          </text>
        ) : null}
        <text x={width - marginRight} y={marginTop - 3} fontSize={10} fill={faint} textAnchor="end">
          {fmtSpendAxis(maxSpend)} €
        </text>
      </svg>
    </div>
  )
}
