// Graphe combiné rendez-vous réels (barres) / montant dépensé (courbe). Style
// épuré inspiré de MAQUETTE-UI.png (padding, légende, double axe) mais
// représentation par campagne conservée (X = numéro de campagne), pas par
// date comme dans la maquette : ce n'est pas notre logique métier. SVG fait
// main (pas de dépendance graphique dans le projet).

import { appointmentsPerDay, campaignDurationDays, realAppointments, spendPerDay } from '@/lib/calculations'
import { indigo, ink, line as lineColor, muted, surface, surfaceAlt, violet } from './format'
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

type ChartPoint = { campaign_number: number; appointments: number; spend: number; durationLabel: string }

function barPath(x: number, width: number, top: number, bottom: number, radius: number): string {
  const height = bottom - top
  const r = Math.max(0, Math.min(radius, height / 2, width / 2))
  return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
}

// Arrondit un maximum brut à un pas "rond" (1/2/5 × 10^n) pour des graduations
// d'axe lisibles (ex. 500 €, 1000 €... plutôt que 437 €, 874 €...), comme
// dans MAQUETTE-UI.png. 4 graduations au-dessus de 0 (5 niveaux au total).
function niceAxisStep(rawMax: number): number {
  if (rawMax <= 0) return 1
  const roughStep = rawMax / 4
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const residual = roughStep / magnitude
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1
  return niceResidual * magnitude
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
    const duration = campaignDurationDays(c.start_date, c.end_date)
    const durationLabel = duration !== null ? `${duration} j` : '—'
    if (mode === 'total') {
      points.push({ campaign_number: c.campaign_number, appointments: realCount, spend: c.meta_spend, durationLabel })
      continue
    }
    const appointments = appointmentsPerDay(realCount, duration)
    const spend = spendPerDay(c.meta_spend, duration)
    if (appointments === null || spend === null) continue
    points.push({ campaign_number: c.campaign_number, appointments, spend, durationLabel })
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
        <InfoIcon size={14} style={{ color: muted }} />
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

  const appointmentsLabel = mode === 'day' ? 'Rendez-vous / jour' : 'Rendez-vous'
  const spendLabel = mode === 'day' ? 'Dépensé / jour (€)' : 'Dépensé (€)'

  const width = 640
  const height = 268
  const marginLeft = 50
  const marginRight = 40
  const marginTop = 14
  const marginBottom = 40
  const plotWidth = width - marginLeft - marginRight
  const plotHeight = height - marginTop - marginBottom
  const baseline = marginTop + plotHeight

  // Axe gauche = Dépensé (€), axe droit = Rendez-vous — ordre de
  // MAQUETTE-UI.png (courbe dépensé calée sur l'axe gauche, barres RDV sur
  // l'axe droit). 5 graduations (0 à 4×pas), valeurs arrondies lisibles.
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
  const fmtSpendAxis = (n: number) => (mode === 'day' ? n.toFixed(2).replace('.', ',') : Math.round(n).toLocaleString('fr-FR'))
  const fmtAppointments = (n: number) => (mode === 'day' ? n.toFixed(2).replace('.', ',') : Math.round(n).toLocaleString('fr-FR'))
  const axisLevels = [0, 1, 2, 3, 4]

  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${lineColor}`, borderRadius: 18, padding: 22 }}>
      {titleRow}
      <p style={{ fontSize: 12, color: muted, margin: '2px 0 14px' }}>Par campagne (n° 1 à 20)</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 12.5, color: muted, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
            <path d="M1 7 L8 4 L14 6 L21 3" fill="none" stroke={indigo} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="14" cy="6" r="2.3" fill={indigo} stroke="#FFFFFF" strokeWidth={1.2} />
          </svg>
          {spendLabel}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i style={{ width: 11, height: 11, borderRadius: 3.5, background: violet, display: 'inline-block' }} />
          {appointmentsLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`${appointmentsLabel} et ${spendLabel.toLowerCase()} par campagne`}
      >
        <style>{`
          .ov-bar, .ov-dot { transition: opacity .15s ease; }
          .ov-bar:hover, .ov-dot:hover { opacity: .72; }
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
            <path key={p.campaign_number} className="ov-bar" d={barPath(x, barWidth, top, baseline, 5)} fill={violet}>
              <title>{`Campagne ${p.campaign_number} — ${fmtAppointments(p.appointments)} rendez-vous${mode === 'day' ? ' / jour' : ''}`}</title>
            </path>
          )
        })}
        {/* Nombre de RDV affiché directement au-dessus de chaque barre — le
            survol (title ci-dessus) reste inchangé, ceci est en plus. */}
        {points.map((p, i) => (
          <text
            key={`count-${p.campaign_number}`}
            x={xCenter(i)}
            y={Math.max(marginTop + 9, yForAppointments(p.appointments) - 6)}
            textAnchor="middle"
            fontSize={10.5}
            fontWeight={700}
            fill={violet}
          >
            {fmtAppointments(p.appointments)}
          </text>
        ))}

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
          <text key={p.campaign_number} x={xCenter(i)} y={height - 20} textAnchor="middle" fontSize={11} fill={muted}>
            {p.campaign_number}
          </text>
        ))}
        {points.map((p, i) => (
          <text key={`dur-${p.campaign_number}`} x={xCenter(i)} y={height - 8} textAnchor="middle" fontSize={9} fill={muted}>
            {p.durationLabel}
          </text>
        ))}
      </svg>
    </div>
  )
}
