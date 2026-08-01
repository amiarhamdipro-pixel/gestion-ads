import { faint, ink, line, radius, surface } from './format'

export default function KpiCard({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  foot,
}: {
  icon: React.ReactNode
  iconColor: string
  iconBg: string
  label: string
  value: string
  foot?: string
}) {
  return (
    <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 17 }}>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          background: iconBg,
          color: iconColor,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {icon}
      </div>
      <div
        style={{
          marginTop: 11,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          color: faint,
        }}
      >
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: 23, marginTop: 3, color: ink }}>{value}</div>
      {foot ? <div style={{ fontSize: 12, color: faint, marginTop: 8 }}>{foot}</div> : null}
    </div>
  )
}
