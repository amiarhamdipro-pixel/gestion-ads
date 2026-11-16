import { accent, ink, line, muted, radius, radiusButton, surface } from './format'

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
    <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: '20px 20px 18px' }}>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: radiusButton,
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
          // Label de la charte : petites capitales espacées, violet, jamais
          // plus présent que la valeur.
          marginTop: 14,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: accent,
        }}
      >
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: 26, marginTop: 4, color: ink, letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {foot ? <div style={{ fontSize: 12, color: muted, marginTop: 8 }}>{foot}</div> : null}
    </div>
  )
}
