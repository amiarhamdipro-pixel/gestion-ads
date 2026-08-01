// Graphe combiné rendez-vous réels (barres) / montant dépensé (courbe). Style
// épuré inspiré de MAQUETTE-UI.png (padding, légende, axes discrets) mais
// représentation par campagne conservée (X = numéro de campagne), pas par
// date comme dans la maquette : ce n'est pas notre logique métier. SVG fait
// main (pas de dépendance graphique dans le projet).

import { appointmentsPerDay, campaignDurationDays, realAppointments, spendPerDay } from '@/lib/calculations'
import { faint, indigo, ink, line as lineColor, muted, surface, surfaceAlt, violet } from './format'
import { InfoIcon } from './icons'

export type OverviewMode = 'total' | 'day'

type ChartCampaign = {
  campaign_number: number
  start_date: string | null
  end_date: string | null
  meta_spend: number
  manual_appointments_adjustment: number
  calendlyAppointments: number
}

type ChartPoint = { campaign_number: number; appointments: number; spend: number }

function barPath(x: number, width: number, top: number, bottom: number, radius: number): string {
  const height = bottom - top
  const r = Math.max(0, Math.min(radius, height / 2, width / 2))
  return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
}

export default function OverviewChart({
  campaigns,
  mode = 'total',
  onModeChange,
}: {
  campaigns: ChartCampaign[]
  mode?: OverviewMode
  onModeChange?: (mode: OverviewMode) => void
}) {
  const points: ChartPoint[] = []
  for (const c of campaigns) {
    const realCount = realAppointments(c.calendlyAppointments, c.manual_appointments_adjustment)
    if (mode === 'total') {
      points.push({ campaign_number: c.campaign_number, appointments: realCount, spend: c.meta_spend })
      continue
    }
    const duration = campaignDurationDays(c.start_date, c.end_date)
    const appointments = appointmentsPerDay(realCount, duration)
    const spend = spendPerDay(c.meta_spend, duration)
    if (appointments === null || spend === null) continue
    points.push({ campaign_number: c.campaign_number, appointments, spend })
  }

  const modeToggle = onModeChange ? (
    <div style={{ display: 'flex', background: surfaceAlt, border: `1px solid ${lineColor}`, borderRadius: 999, padding: 3, flexShrink: 0 }}>
      {(['total', 'day'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onModeChange(m)}
          style={{
            border: 0,
            borderRadius: 999,
            padding: '5px 12px',
            fontSize: 12,
            cursor: 'pointer',
            background: mode === m ? surface : 'transparent',
            fontWeight: mode === m ? 600 : 400,
          }}
        >
          {m === 'total' ? 'Totaux' : 'Par jour'}
        </button>
      ))}
    </div>
  ) : null

  const titleRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <h2 style={{ fontWeight: 700, fontSize: 15.5, color: ink, margin: 0 }}>
          Évolution des rendez-vous et du dépensé
        </h2>
        <InfoIcon size={14} style={{ color: faint }} />
      </div>
      {modeToggle}
    </div>
  )

  if (points.length === 0) {
    return (
      <div style={{ background: '#FFFFFF', border: `1px solid ${lineColor}`, borderRadius: 18, padding: 22 }}>
        {titleRow}
        <div style={{ padding: '28px 0 6px', textAlign: 'center', color: muted, fontSize: 13.5 }}>
          {mode === 'day' && campaigns.length > 0
            ? 'Aucune campagne avec une durée connue (date de fin non renseignée).'
            : 'Aucune campagne à afficher pour le moment.'}
        </div>
      </div>
    )
  }

  const hasAppointments = points.some((p) => p.appointments > 0)
  const appointmentsLabel = mode === 'day' ? 'Rendez-vous / jour' : 'Rendez-vous'
  const spendLabel = mode === 'day' ? 'Dépensé / jour' : 'Dépensé (€)'

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
  const gridTicks = [0, 0.5, 1]
  const fmtSpend = (n: number) => n.toFixed(2).replace('.', ',')
  const fmtSpendAxis = (n: number) =>
    mode === 'day' ? n.toFixed(2).replace('.', ',') : Math.round(n).toLocaleString('fr-FR')
  const fmtAppointments = (n: number) =>
    mode === 'day' ? n.toFixed(2).replace('.', ',') : Math.round(n).toLocaleString('fr-FR')

  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${lineColor}`, borderRadius: 18, padding: 22 }}>
      {titleRow}
      <p style={{ fontSize: 12, color: faint, margin: '2px 0 14px' }}>Par campagne (n° 1 à 20)</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 12.5, color: muted, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
            <path d="M1 7 L8 4 L14 6 L21 3" fill="none" stroke={indigo} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="14" cy="6" r="2.3" fill={indigo} stroke="#FFFFFF" strokeWidth={1.2} />
          </svg>
          {spendLabel}
        </span>
        {hasAppointments ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <i style={{ width: 11, height: 11, borderRadius: 3.5, background: violet, display: 'inline-block' }} />
            {appointmentsLabel}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: faint }}>Aucun rendez-vous rattaché aux campagnes</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={
          hasAppointments
            ? `${appointmentsLabel} et ${spendLabel.toLowerCase()} par campagne`
            : `${spendLabel} par campagne — aucun rendez-vous rattaché`
        }
      >
        <style>{`
          .ov-bar, .ov-dot { transition: opacity .15s ease; }
          .ov-bar:hover, .ov-dot:hover { opacity: .72; }
        `}</style>

        {gridTicks.map((t) => (
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
                <path key={p.campaign_number} className="ov-bar" d={barPath(x, barWidth, top, baseline, 5)} fill={violet}>
                  <title>{`Campagne ${p.campaign_number} — ${fmtAppointments(p.appointments)} rendez-vous${mode === 'day' ? ' / jour' : ''}`}</title>
                </path>
              )
            })
          : null}

        <polyline
          points={linePoints}
          fill="none"
          stroke={indigo}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle
            key={p.campaign_number}
            className="ov-dot"
            cx={xCenter(i)}
            cy={yForSpend(p.spend)}
            r={3.6}
            fill={indigo}
            stroke="#FFFFFF"
            strokeWidth={2}
          >
            <title>{`Campagne ${p.campaign_number} — ${fmtSpend(p.spend)} € dépensés${mode === 'day' ? ' / jour' : ''}`}</title>
          </circle>
        ))}

        {points.map((p, i) => (
          <text key={p.campaign_number} x={xCenter(i)} y={height - 7} textAnchor="middle" fontSize={11} fill={muted}>
            {p.campaign_number}
          </text>
        ))}

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
