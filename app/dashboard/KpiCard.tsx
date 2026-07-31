import { faint, ink, line, muted, radius, surface } from './format'

export default function KpiCard({
  label,
  color,
  value,
  foot,
}: {
  label: string
  color: string
  value: string
  foot?: string
}) {
  return (
    <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: muted, fontWeight: 500 }}>
        <i style={{ width: 9, height: 9, borderRadius: 3, background: color, display: 'inline-block' }} />
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: 26, marginTop: 8, color: ink }}>{value}</div>
      {foot ? <div style={{ fontSize: 12, color: faint, marginTop: 6 }}>{foot}</div> : null}
    </div>
  )
}
