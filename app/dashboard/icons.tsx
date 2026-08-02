// Jeu d'icônes minimal, dessinées à la main (SVG, trait `currentColor`) —
// aucune dépendance d'icônes ajoutée au projet. Style trait fin cohérent,
// repris sur toute la sidebar/header/KPI pour coller à MAQUETTE-UI.png.

type IconProps = { size?: number; style?: React.CSSProperties }

function base(children: React.ReactNode, { size = 18, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function HomeIcon(props: IconProps) {
  return base(
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9h12v-9" />
    </>,
    props
  )
}

export function CompareIcon(props: IconProps) {
  return base(
    <>
      <path d="M8 4 4 8l4 4" />
      <path d="M4 8h13" />
      <path d="M16 20l4-4-4-4" />
      <path d="M20 16H7" />
    </>,
    props
  )
}

export function SyncIcon(props: IconProps) {
  return base(
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-14 5.3L4 16" />
      <path d="M4 20v-4h4" />
    </>,
    props
  )
}

export function UserIcon(props: IconProps) {
  return base(
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.5 20c1-4 3.7-6.2 7.5-6.2S18.5 16 19.5 20" />
    </>,
    props
  )
}

export function TrendingUpIcon(props: IconProps) {
  return base(
    <>
      <path d="M4 16l6-6 4 4 6-7" />
      <path d="M15 7h5v5" />
    </>,
    props
  )
}

export function DollarIcon(props: IconProps) {
  return base(
    <>
      <path d="M12 3v18" />
      <path d="M17 7.5c0-2-2-3-5-3s-5 1.2-5 3.2S9 10.5 12 11s5 1.3 5 3.3-2 3.2-5 3.2-5-1-5-3" />
    </>,
    props
  )
}

export function CalendarIcon(props: IconProps) {
  return base(
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>,
    props
  )
}

export function CrownIcon(props: IconProps) {
  return base(
    <>
      <path d="M4 18h16l-1.4-8.2L14.5 13 12 6.5 9.5 13 5.4 9.8Z" />
      <path d="M4 20.5h16" />
    </>,
    props
  )
}

export function ClockIcon(props: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
    props
  )
}

export function ChevronDownIcon(props: IconProps) {
  return base(<path d="M6 9l6 6 6-6" />, props)
}

export function InfoIcon(props: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.8v.1" />
    </>,
    props
  )
}

export function TrackingIcon(props: IconProps) {
  return base(
    <>
      <path d="M4 19v-5.5" />
      <path d="M10 19V8" />
      <path d="M16 19v-9.5" />
      <path d="M20 19V5" />
      <path d="m3 8 5-4 5 3.5L19 4" />
    </>,
    props
  )
}

export function LogoutIcon(props: IconProps) {
  return base(
    <>
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15.5 16 20 12l-4.5-4" />
      <path d="M20 12H9" />
    </>,
    props
  )
}

export function MailIcon(props: IconProps) {
  return base(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <path d="m4 7 8 6 8-6" />
    </>,
    props
  )
}

export function LockIcon(props: IconProps) {
  return base(
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>,
    props
  )
}

export function EyeIcon(props: IconProps) {
  return base(
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
    props
  )
}

export function EyeOffIcon(props: IconProps) {
  return base(
    <>
      <path d="M6.5 6.9C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6" />
      <path d="M10.6 5.7A10.6 10.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.6 15.6 0 0 1-3.2 4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </>,
    props
  )
}
