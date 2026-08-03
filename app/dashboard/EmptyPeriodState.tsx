import { line, muted, radius, surface } from './format'

// État vide partagé quand le filtre de période n'a aucune ligne
// campaign_daily_stats correspondante — jamais de KPI/graphique/tableau
// calculé sur un ensemble vide.
export default function EmptyPeriodState() {
  return (
    <div
      style={{
        background: surface,
        border: `1px dashed ${line}`,
        borderRadius: radius,
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 15, fontWeight: 600, color: muted, margin: 0 }}>Aucune donnée sur cette période.</p>
      <p style={{ fontSize: 13, color: muted, marginTop: 6 }}>
        Choisissez une autre période dans le filtre du header.
      </p>
    </div>
  )
}
