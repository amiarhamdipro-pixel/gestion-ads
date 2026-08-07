// Graphe combiné rendez-vous réels (barres) / montant dépensé (courbe). SVG
// fait main (pas de dépendance graphique dans le projet). Deux bascules
// indépendantes :
// - Par campagne / Par mois (grouping, état interne à ce composant) : une
//   barre par campagne (comportement historique, inchangé) ou une barre par
//   mois CIVIL — voir buildMonthPoints ci-dessous pour la source réelle
//   (campaign_daily_stats, jamais le total lifetime d'une campagne rattaché
//   au mois de sa start_date : c'était le bug corrigé lors de cette tâche,
//   voir le rapport correspondant pour l'audit chiffré complet).
// - Totaux / Par jour (mode, prop contrôlée par OverviewSection.tsx, pilote
//   aussi le tableau des campagnes en dessous) : uniquement pertinente en
//   grouping="campaign" — une moyenne "par jour" sommée sur plusieurs
//   campagnes d'un même mois n'aurait pas de sens directement comparable,
//   donc masquée et forcée à "total" en grouping="month" (le fichier ne
//   calcule rien de nouveau, il choisit juste quelle donnée déjà existante
//   afficher).
//
// Campagnes historiques (sync_locked) vs dynamiques : ce composant ne lit
// jamais sync_locked — la distinction pertinente pour "Par mois" est la
// PRÉSENCE réelle de lignes campaign_daily_stats (voir dailyStats plus bas),
// pas un champ de statut.

import { useState } from 'react'
import { appointmentsPerDay, campaignDurationDays, realAppointments, spendPerDay } from '@/lib/calculations'
import { chartOrange, faint, ink, line as lineColor, muted, surface, surfaceAlt, violet } from './format'
import { ChevronDownIcon, InfoIcon } from './icons'

export type OverviewMode = 'total' | 'day'
type Grouping = 'campaign' | 'month'

type ChartCampaign = {
  id: string
  campaign_number: number
  start_date: string | null
  end_date: string | null
  meta_spend: number
  manual_appointments_adjustment: number
  calendlyAppointments: number
}

// Ligne brute campaign_daily_stats (voir types/database.ts, CampaignDailyStat)
// — stat_date dérivée de booking_created_at pour les RDV (lib/sync/
// syncCalendlyDailyStats.ts) : la seule source permettant un vrai
// rattachement par mois CIVIL (un RDV pris le 25 juillet compte pour
// juillet, même si le rendez-vous est prévu en août). Fournie par
// OverviewSection.tsx (elle-même alimentée par app/dashboard/page.tsx),
// jamais recalculée ici à partir d'autre chose.
export type MonthlyStatRow = {
  campaign_id: string
  stat_date: string
  meta_spend: number
  calendly_appointments: number
}

// Point générique du graphe : xLabel (ligne du bas, grasse) et xSubLabel
// (ligne du bas, discrète, optionnelle) portent le libellé selon le
// groupement actif — numéro de campagne + durée, ou nom de mois seul.
type ChartPoint = {
  key: string
  appointments: number
  spend: number
  xLabel: string
  xSubLabel: string | null
  tooltipLabel: string
}

// Nombre de points affichés par page. Au-delà, le graphique devient
// illisible (barres trop fines, libellés qui se chevauchent) — voir aussi le
// mécanisme de largeur minimale/scroll horizontal plus bas, qui protège la
// lisibilité mobile pour un nombre de points inférieur à ce seuil.
// page=0 = les PAGE_SIZE plus récents ; page croissant = de plus en plus
// ancien. Découpage par blocs fixes de PAGE_SIZE en partant de la fin du
// tableau (le plus récent) : chaque campagne appartient à EXACTEMENT une
// page (jamais perdue, jamais dupliquée entre deux pages adjacentes), y
// compris la première page (la plus ancienne), qui peut être plus petite
// que PAGE_SIZE si le total n'est pas un multiple exact (vérifié à la main
// pour 21 et 25 points). Uniquement appliqué en groupement "Par campagne"
// (voir plus bas) : le mode "Par mois" affiche toujours la série complète.
const PAGE_SIZE = 12

function pageOfPoints(allPoints: ChartPoint[], page: number, pageSize: number): ChartPoint[] {
  if (allPoints.length <= pageSize) return allPoints
  const end = allPoints.length - page * pageSize
  const start = Math.max(0, end - pageSize)
  return allPoints.slice(start, end)
}

function barPath(x: number, width: number, top: number, bottom: number, radius: number): string {
  const height = bottom - top
  const r = Math.max(0, Math.min(radius, height / 2, width / 2))
  return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
}

// Arrondit un maximum brut à un pas "rond" (1/2/5 × 10^n) pour des graduations
// d'axe lisibles (ex. 500 €, 1000 €... plutôt que 437 €, 874 €...). 4
// graduations au-dessus de 0 (5 niveaux au total).
function niceAxisStep(rawMax: number): number {
  if (rawMax <= 0) return 1
  const roughStep = rawMax / 4
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const residual = roughStep / magnitude
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1
  return niceResidual * magnitude
}

// Mois civil d'une date calendaire "YYYY-MM-DD" — en chaîne, jamais via
// Date() (stat_date, comme campaigns.start_date, est une simple date
// calendaire ; passer par un objet Date réintroduirait un risque de
// décalage de fuseau horaire pour rien, alors qu'un découpage de chaîne
// suffit et reste exact). Utilisé sur campaign_daily_stats.stat_date (voir
// buildMonthPoints) — jamais sur start_date d'une campagne (voir le
// correctif documenté sur buildMonthPoints).
function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

// Format compact MM/YY (ex. "08/25") — évite le chevauchement des libellés
// sur l'axe en mode "Par mois" (les noms de mois complets étaient trop longs
// une fois plusieurs points affichés côte à côte).
function monthLabel(dateStr: string): string {
  const yearShort = dateStr.slice(2, 4)
  const month = dateStr.slice(5, 7)
  return `${month}/${yearShort}`
}

function buildCampaignPoints(campaigns: ChartCampaign[], mode: OverviewMode): ChartPoint[] {
  const points: ChartPoint[] = []
  for (const c of campaigns) {
    const realCount = realAppointments(c.calendlyAppointments, c.manual_appointments_adjustment)
    const duration = campaignDurationDays(c.start_date, c.end_date)
    const durationLabel = duration !== null ? `${duration} j` : '—'

    let appointments: number | null = realCount
    let spend: number | null = c.meta_spend
    if (mode === 'day') {
      appointments = appointmentsPerDay(realCount, duration)
      spend = spendPerDay(c.meta_spend, duration)
    }
    if (appointments === null || spend === null) continue

    points.push({
      key: String(c.campaign_number),
      appointments,
      spend,
      xLabel: String(c.campaign_number),
      xSubLabel: durationLabel,
      tooltipLabel: `Campagne ${c.campaign_number}`,
    })
  }
  return points
}

// Toujours des totaux (jamais "par jour" : sommer une moyenne journalière de
// plusieurs campagnes distinctes n'aurait pas de sens sans inventer une
// pondération).
//
// CORRECTIF DE RECETTE (voir le rapport de tâche pour l'audit chiffré
// complet) : rattachait auparavant le TOTAL LIFETIME d'une campagne
// (calendlyAppointments + manual_appointments_adjustment) au seul mois de
// sa start_date — ex. campagne 19 (start 30/06, 23 RDV réels) comptait
// entièrement pour juin, alors que 22 de ces 23 RDV avaient réellement été
// réservés en juillet (booking_created_at). Corrigé pour sommer
// dailyStats (campaign_daily_stats, stat_date dérivée de booking_created_at
// — voir MonthlyStatRow ci-dessus) par mois civil réel : un rendez-vous pris
// le 25 juillet compte pour juillet même si son créneau est prévu en août,
// conformément à la règle déjà validée pour les campagnes dynamiques.
// manual_appointments_adjustment est un correctif SANS DATE (voir
// lib/calculations.ts) : jamais rattaché à un mois précis, donc absent
// d'ici — même principe que pour une campagne sans aucune ligne
// campaign_daily_stats (import Excel pur, jamais synchronisée
// dynamiquement) : ni l'une ni l'autre ne sont réparties arbitrairement,
// elles sont simplement absentes de ce mode (voir excludedCampaignCount,
// affiché à l'utilisateur — jamais une donnée silencieusement inventée).
function buildMonthPoints(
  campaigns: ChartCampaign[],
  dailyStats: MonthlyStatRow[]
): { points: ChartPoint[]; excludedCampaignCount: number } {
  const buckets = new Map<string, { appointments: number; spend: number }>()
  for (const row of dailyStats) {
    const key = monthKey(row.stat_date)
    const existing = buckets.get(key) ?? { appointments: 0, spend: 0 }
    existing.appointments += row.calendly_appointments
    existing.spend += row.meta_spend
    buckets.set(key, existing)
  }

  const coveredCampaignIds = new Set(dailyStats.map((row) => row.campaign_id))
  const excludedCampaignCount = campaigns.filter((c) => !coveredCampaignIds.has(c.id)).length

  const points = Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => ({
      key,
      appointments: v.appointments,
      spend: v.spend,
      // monthLabel n'utilise que les positions [2,4) et [5,7) de la chaîne
      // reçue (année/mois courts) : une clé "YYYY-MM" (7 caractères) donne
      // exactement le même résultat qu'une date complète "YYYY-MM-DD".
      xLabel: monthLabel(key),
      xSubLabel: null,
      tooltipLabel: monthLabel(key),
    }))

  return { points, excludedCampaignCount }
}

function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div style={{ display: 'flex', background: surfaceAlt, border: `1px solid ${lineColor}`, borderRadius: 999, padding: 3, flexShrink: 0 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          style={{
            border: 0,
            borderRadius: 999,
            padding: '5px 12px',
            fontSize: 12.5,
            cursor: 'pointer',
            background: value === opt.value ? surface : 'transparent',
            color: value === opt.value ? ink : muted,
            fontWeight: value === opt.value ? 700 : 500,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Navigation entre pages de campagnes (voir pageOfPoints ci-dessus). Vrais
// <button> (accessibilité — jamais un <div> cliquable), taille 36px
// (utilisable au doigt sur mobile), aria-label explicite plutôt qu'une
// simple icône décorative. ChevronDownIcon (déjà utilisée ailleurs dans le
// dashboard, voir icons.tsx) pivotée à 90°/-90° plutôt qu'une nouvelle
// icône dédiée — aucune dépendance ajoutée.
function NavButton({
  direction,
  disabled,
  onClick,
  label,
}: {
  direction: 'older' | 'newer'
  disabled: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        flexShrink: 0,
        borderRadius: 999,
        border: `1px solid ${lineColor}`,
        background: surface,
        color: disabled ? faint : ink,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ChevronDownIcon size={16} style={{ transform: direction === 'older' ? 'rotate(90deg)' : 'rotate(-90deg)' }} />
    </button>
  )
}

export default function OverviewChart({
  campaigns,
  dailyStats,
  mode = 'total',
  onModeChange,
}: {
  campaigns: ChartCampaign[]
  dailyStats: MonthlyStatRow[]
  mode?: OverviewMode
  onModeChange?: (mode: OverviewMode) => void
}) {
  const [grouping, setGrouping] = useState<Grouping>('campaign')
  const [page, setPage] = useState(0)

  const effectiveMode: OverviewMode = grouping === 'month' ? 'total' : mode
  const monthResult = grouping === 'month' ? buildMonthPoints(campaigns, dailyStats) : null
  const allPoints = monthResult ? monthResult.points : buildCampaignPoints(campaigns, effectiveMode)
  const excludedFromMonth = monthResult?.excludedCampaignCount ?? 0

  // Pagination uniquement en groupement "Par campagne" (voir PAGE_SIZE
  // ci-dessus) : le mode "Par mois" affiche toujours l'intégralité de la
  // série, jamais tronquée (le débordement horizontal reste géré par
  // chartMinWidth/overflow-x plus bas, comme pour n'importe quel nombre de
  // points). totalPages toujours ≥ 1 pour éviter une division par un total
  // de pages nul. page n'est volontairement jamais réinitialisée par un
  // changement de groupement/mode (Par campagne ↔ Par mois, Totaux ↔ Par
  // jour) : elle est simplement recalée (clampedPage) si le nombre total de
  // points a changé entre-temps (ex. mode "Par jour", qui exclut les
  // campagnes sans durée connue) — jamais de page vide ni d'incohérence,
  // jamais un retour surprise à la première page tant que la page demandée
  // reste valide.
  const totalPages = grouping === 'campaign' ? Math.max(1, Math.ceil(allPoints.length / PAGE_SIZE)) : 1
  const clampedPage = Math.max(0, Math.min(page, totalPages - 1))
  const points = grouping === 'campaign' ? pageOfPoints(allPoints, clampedPage, PAGE_SIZE) : allPoints
  const canGoOlder = grouping === 'campaign' && clampedPage < totalPages - 1
  const canGoNewer = grouping === 'campaign' && clampedPage > 0

  const groupingToggle = (
    <ToggleGroup
      value={grouping}
      onChange={setGrouping}
      options={[
        { value: 'campaign', label: 'Par campagne' },
        { value: 'month', label: 'Par mois' },
      ]}
    />
  )

  const modeToggle =
    grouping === 'campaign' && onModeChange ? (
      <ToggleGroup
        value={mode}
        onChange={onModeChange}
        options={[
          { value: 'total', label: 'Totaux' },
          { value: 'day', label: 'Par jour' },
        ]}
      />
    ) : null

  const titleRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <h2 style={{ fontWeight: 700, fontSize: 16, color: ink, margin: 0 }}>
          Évolution des rendez-vous et du dépensé
        </h2>
        <InfoIcon size={14} style={{ color: muted }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {groupingToggle}
        {modeToggle}
      </div>
    </div>
  )

  if (allPoints.length === 0) {
    return (
      <div style={{ background: surface, border: `1px solid ${lineColor}`, borderRadius: 18, padding: 22 }}>
        {titleRow}
        <div style={{ padding: '28px 0 6px', textAlign: 'center', color: muted, fontSize: 13.5 }}>
          {grouping === 'campaign' && effectiveMode === 'day' && campaigns.length > 0
            ? 'Aucune campagne avec une durée connue (date de fin non renseignée).'
            : grouping === 'month' && campaigns.length > 0
              ? 'Aucune donnée journalière disponible pour le mode Par mois (campagnes jamais synchronisées dynamiquement).'
              : 'Aucune campagne à afficher pour le moment.'}
        </div>
      </div>
    )
  }

  const appointmentsLabel = effectiveMode === 'day' ? 'Rendez-vous / jour' : 'Rendez-vous'
  const spendLabel = effectiveMode === 'day' ? 'Dépensé / jour (€)' : 'Dépensé (€)'

  const width = 640
  const height = 300
  const marginLeft = 54
  const marginRight = 44
  const marginTop = 20
  // Marge basse : espace dédié aux libellés X (numéro de campagne/mois,
  // + durée en jours pour le groupement "Par campagne"), toujours SOUS le
  // tracé (baseline), jamais recouverte par la courbe des dépenses (qui ne
  // descend jamais plus bas que la baseline — voir yForSpend ci-dessous).
  // Relevée pour garantir une marge de lecture confortable entre la
  // baseline et la première ligne de texte, sur les deux groupements.
  const marginBottom = grouping === 'month' ? 46 : 58
  const plotWidth = width - marginLeft - marginRight
  const plotHeight = height - marginTop - marginBottom
  const baseline = marginTop + plotHeight

  // Axe gauche = Dépensé (€), axe droit = Rendez-vous. 5 graduations (0 à
  // 4×pas), valeurs arrondies lisibles.
  const spendStep = niceAxisStep(Math.max(1, ...points.map((p) => p.spend)))
  const spendAxisMax = spendStep * 4
  const apptStep = niceAxisStep(Math.max(1, ...points.map((p) => p.appointments)))
  const apptAxisMax = apptStep * 4

  const slot = plotWidth / points.length
  const barWidth = Math.min(28, slot * 0.5)

  const yForAppointments = (appointments: number) => baseline - (appointments / apptAxisMax) * plotHeight
  const yForSpend = (spend: number) => baseline - (spend / spendAxisMax) * plotHeight
  const xCenter = (index: number) => marginLeft + slot * index + slot / 2

  const linePoints = points.map((p, i) => `${xCenter(i)},${yForSpend(p.spend)}`).join(' ')
  const fmtSpend = (n: number) => n.toFixed(2).replace('.', ',')
  const fmtSpendAxis = (n: number) => (effectiveMode === 'day' ? n.toFixed(2).replace('.', ',') : Math.round(n).toLocaleString('fr-FR'))
  const fmtAppointments = (n: number) => (effectiveMode === 'day' ? n.toFixed(2).replace('.', ',') : Math.round(n).toLocaleString('fr-FR'))
  const axisLevels = [0, 1, 2, 3, 4]

  // Largeur minimale du SVG rendu : protège la lisibilité des barres sur
  // petit écran (contrainte "ne jamais réduire les barres jusqu'à devenir
  // illisibles") — en dessous de ce seuil, le conteneur défile
  // horizontalement (overflowX) plutôt que de comprimer les barres. Les
  // libellés "Par mois" sont désormais compacts ("08/25"), mais restent
  // légèrement plus larges qu'un simple numéro de campagne : seuil par point
  // un peu plus généreux dans ce mode.
  const minPxPerPoint = grouping === 'month' ? 58 : 50
  const chartMinWidth = Math.max(width, points.length * minPxPerPoint + marginLeft + marginRight)

  // Groupement "Par mois" : sous-titre simple, jamais de navigation (voir
  // NavButton — masquée dans ce mode, pas seulement désactivée, la
  // pagination par campagne n'ayant pas de sens ici). Groupement
  // "Par campagne" : plage exacte affichée + navigation, format demandé
  // "Campagnes 10–21 sur 21" (tiret demi-cadratin).
  const monthSubtitle = `Par mois (${points[0].xLabel} à ${points[points.length - 1].xLabel})`
  const rangeLabel = `Campagnes ${points[0].xLabel}–${points[points.length - 1].xLabel} sur ${allPoints.length}`

  return (
    <div style={{ background: surface, border: `1px solid ${lineColor}`, borderRadius: 18, padding: 22 }}>
      {titleRow}
      {grouping === 'campaign' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 16px' }}>
          <NavButton
            direction="older"
            disabled={!canGoOlder}
            onClick={() => setPage(clampedPage + 1)}
            label="Voir les campagnes précédentes"
          />
          <span style={{ fontSize: 12.5, color: muted }}>{rangeLabel}</span>
          <NavButton
            direction="newer"
            disabled={!canGoNewer}
            onClick={() => setPage(clampedPage - 1)}
            label="Voir les campagnes suivantes"
          />
        </div>
      ) : (
        <div style={{ margin: '4px 0 16px' }}>
          <p style={{ fontSize: 12.5, color: muted, margin: 0 }}>{monthSubtitle}</p>
          {excludedFromMonth > 0 ? (
            <p style={{ fontSize: 11.5, color: muted, margin: '2px 0 0' }}>
              {excludedFromMonth} campagne{excludedFromMonth > 1 ? 's' : ''} sans détail journalier exclue
              {excludedFromMonth > 1 ? 's' : ''} de ce mode (jamais synchronisées dynamiquement, aucune granularité
              mensuelle disponible).
            </p>
          ) : null}
        </div>
      )}

      {/* Légende : carré plein = RDV (barres), trait = Dépensé (courbe) —
          couleurs alignées sur celles réellement utilisées ci-dessous. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 13, color: ink, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i style={{ width: 12, height: 12, borderRadius: 3.5, background: violet, display: 'inline-block', flexShrink: 0 }} aria-hidden="true" />
          {appointmentsLabel}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="20" height="10" viewBox="0 0 20 10" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
            <line x1="1" y1="5" x2="19" y2="5" stroke={chartOrange} strokeWidth={3} strokeLinecap="round" />
          </svg>
          {spendLabel}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', minWidth: chartMinWidth, height: 'auto', display: 'block' }}
          role="img"
          aria-label={`${appointmentsLabel} et ${spendLabel.toLowerCase()} ${grouping === 'month' ? 'par mois' : 'par campagne'}`}
        >
          <style>{`
            .ov-bar, .ov-dot { transition: opacity .15s ease; }
            .ov-bar:hover, .ov-dot:hover { opacity: .75; }
          `}</style>

          {axisLevels.map((lvl) => {
            const y = marginTop + plotHeight * (1 - lvl / 4)
            return (
              <g key={lvl}>
                <line x1={marginLeft} x2={width - marginRight} y1={y} y2={y} stroke={lineColor} strokeWidth={1} />
                <text x={marginLeft - 10} y={y} textAnchor="end" dominantBaseline="middle" fontSize={12} fontWeight={500} fill={ink}>
                  {fmtSpendAxis(spendStep * lvl)} €
                </text>
                <text x={width - marginRight + 10} y={y} textAnchor="start" dominantBaseline="middle" fontSize={12} fontWeight={500} fill={ink}>
                  {fmtAppointments(apptStep * lvl)}
                </text>
              </g>
            )
          })}

          {points.map((p, i) => {
            const top = yForAppointments(p.appointments)
            const x = xCenter(i) - barWidth / 2
            return (
              <path key={p.key} className="ov-bar" d={barPath(x, barWidth, top, baseline, 5)} fill={violet}>
                <title>{`${p.tooltipLabel} — ${fmtAppointments(p.appointments)} rendez-vous${effectiveMode === 'day' ? ' / jour' : ''}`}</title>
              </path>
            )
          })}
          {/* Nombre de RDV affiché directement au-dessus de chaque barre —
              toujours visible, jamais besoin de survoler (le survol via
              <title> ci-dessus reste disponible en complément). */}
          {points.map((p, i) => (
            <text
              key={`count-${p.key}`}
              x={xCenter(i)}
              y={Math.max(marginTop + 11, yForAppointments(p.appointments) - 8)}
              textAnchor="middle"
              fontSize={12.5}
              fontWeight={700}
              fill={violet}
            >
              {fmtAppointments(p.appointments)}
            </text>
          ))}

          <polyline
            points={linePoints}
            fill="none"
            stroke={chartOrange}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) => (
            <circle
              key={p.key}
              className="ov-dot"
              cx={xCenter(i)}
              cy={yForSpend(p.spend)}
              r={3.5}
              fill={chartOrange}
              stroke={surface}
              strokeWidth={1.5}
            >
              <title>{`${p.tooltipLabel} — ${fmtSpend(p.spend)} € dépensés${effectiveMode === 'day' ? ' / jour' : ''}`}</title>
            </circle>
          ))}

          {points.map((p, i) => (
            <text key={p.key} x={xCenter(i)} y={height - (p.xSubLabel ? 22 : 12)} textAnchor="middle" fontSize={12.5} fontWeight={600} fill={ink}>
              {p.xLabel}
            </text>
          ))}
          {points.map((p, i) =>
            p.xSubLabel ? (
              <text key={`sub-${p.key}`} x={xCenter(i)} y={height - 8} textAnchor="middle" fontSize={10.5} fill={muted}>
                {p.xSubLabel}
              </text>
            ) : null
          )}
        </svg>
      </div>
    </div>
  )
}
