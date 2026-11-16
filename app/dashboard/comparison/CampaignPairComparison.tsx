import { accent, amber, ctaBorder, formatCost, formatEur, gray, ink, line, muted, radius, radiusButton, softBg, surface, surfaceAlt } from '../format'

// Comparateur A/B de deux campagnes (page Comparaison, mode sans filtre de
// période uniquement : durée complète de chaque campagne, jamais la période
// filtrée). Composant serveur (aucun 'use client') : formulaire GET
// cmp_a/cmp_b, rendu sans JavaScript.
//
// Aucune donnée recalculée ici : les valeurs viennent telles quelles des
// lignes déjà calculées par page.tsx (comparisonRows : campaignDurationDays,
// realAppointments, appointmentsPerDay, realCostPerAppointment). Seuls les
// deux écarts validés sont calculés : RDV/jour (plus haut = meilleur) et coût
// réel/RDV (plus bas = meilleur). Convention : écart = A − B, pourcentage =
// (A − B) ÷ |B|.

export type PairCampaign = {
  id: string
  campaignNumber: number
  // end_date absente : campagne en cours -> durée et RDV/jour indisponibles.
  ongoing: boolean
  // sync_locked : référence historique (import Excel) ou campagne figée.
  historical: boolean
  durationDays: number | null
  realAppointments: number
  appointmentsPerDay: number | null
  spend: number
  realCostPerAppointment: number | null
  // null pour un compte client (jamais transmis, voir page.tsx).
  leads: number | null
}

export type MetricDelta = {
  absolute: number
  // null si B = 0 (division par zéro).
  percent: number | null
  // null en cas d'égalité.
  winner: 'A' | 'B' | null
}

export type PairComparison =
  | { status: 'not_enough_campaigns' }
  | { status: 'incomplete'; a: PairCampaign | null; b: PairCampaign | null }
  | { status: 'same'; a: PairCampaign }
  | { status: 'ready'; a: PairCampaign; b: PairCampaign; perDay: MetricDelta | null; cost: MetricDelta | null }

const EPSILON = 1e-9

// Écart A − B d'un indicateur ; null si l'une des deux valeurs est
// indisponible (aucun gagnant désigné).
export function compareMetric(a: number | null, b: number | null, higherIsBetter: boolean): MetricDelta | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null
  const absolute = a - b
  const tie = Math.abs(absolute) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b))
  return {
    absolute: tie ? 0 : absolute,
    percent: b === 0 ? null : tie ? 0 : absolute / Math.abs(b),
    winner: tie ? null : higherIsBetter === (a > b) ? 'A' : 'B',
  }
}

// Résout cmp_a/cmp_b UNIQUEMENT parmi les campagnes déjà accessibles
// (publiées pour un client) : un identifiant absent, inconnu ou non autorisé
// est traité comme une sélection manquante — jamais d'erreur, jamais de
// donnée d'une autre campagne.
export function buildPairComparison(campaigns: PairCampaign[], aId: string, bId: string): PairComparison {
  if (campaigns.length < 2) return { status: 'not_enough_campaigns' }
  const a = campaigns.find((c) => c.id === aId) ?? null
  const b = campaigns.find((c) => c.id === bId) ?? null
  if (!a || !b) return { status: 'incomplete', a, b }
  if (a.id === b.id) return { status: 'same', a }
  return {
    status: 'ready',
    a,
    b,
    // Campagne en cours : aucun écart RDV/jour (garanti même si une valeur
    // était fournie).
    perDay: a.ongoing || b.ongoing ? null : compareMetric(a.appointmentsPerDay, b.appointmentsPerDay, true),
    cost: compareMetric(a.realCostPerAppointment, b.realCostPerAppointment, false),
  }
}

// Mêmes formats que le tableau de page.tsx (formatDuration / formatPerDay,
// non exportés par une page Next.js).
function formatDuration(c: PairCampaign): string {
  if (c.ongoing) return 'En cours'
  return c.durationDays === null ? '—' : `${c.durationDays} j`
}

function formatPerDay(n: number | null): string {
  return n === null ? '—' : n.toFixed(2).replace('.', ',')
}

function signed(n: number, text: string): string {
  return n > 0 ? `+${text}` : n < 0 ? `−${text}` : text
}

function formatPercent(p: number | null): string {
  return p === null ? '' : ` (${signed(p, `${Math.abs(p * 100).toFixed(1).replace('.', ',')} %`)})`
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: ink, background: softBg(color, 0.16), borderRadius: 999, padding: '2px 7px' }}>
      {label}
    </span>
  )
}

function CampaignHeading({ side, campaign }: { side: 'A' | 'B'; campaign: PairCampaign }) {
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
      <span style={{ fontWeight: 700, color: accent }}>
        {side} · Campagne {campaign.campaignNumber}
      </span>
      {campaign.historical ? <Badge label="Historique" color={gray} /> : null}
      {campaign.ongoing ? <Badge label="En cours" color={amber} /> : null}
    </span>
  )
}

function DeltaLine({ label, delta, unavailable, format, pair }: { label: string; delta: MetricDelta | null; unavailable: string; format: (n: number) => string; pair: { a: PairCampaign; b: PairCampaign } }) {
  let text: string
  if (!delta) {
    text = unavailable
  } else if (delta.winner === null) {
    text = 'Égalité'
  } else {
    const winner = delta.winner === 'A' ? pair.a : pair.b
    text = `${signed(delta.absolute, format(Math.abs(delta.absolute)))}${formatPercent(delta.percent)} · Avantage : ${delta.winner} (campagne ${winner.campaignNumber})`
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, padding: '8px 0', borderTop: `1px solid ${line}`, fontSize: 13 }}>
      <span style={{ color: muted }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{text}</span>
    </div>
  )
}

export default function CampaignPairComparison({
  campaigns,
  aId,
  bId,
  isAdmin,
}: {
  campaigns: PairCampaign[]
  aId: string
  bId: string
  isAdmin: boolean
}) {
  const comparison = buildPairComparison(campaigns, aId, bId)
  const selectStyle: React.CSSProperties = {
    height: 44,
    padding: '0 10px',
    borderRadius: radiusButton,
    border: `1px solid ${line}`,
    background: surface,
    color: ink,
    font: 'inherit',
    fontSize: 13,
    minWidth: 0,
  }
  const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, fontWeight: 600, color: muted, flex: '1 1 160px' }
  const optionLabel = (c: PairCampaign) => `Campagne ${c.campaignNumber}${c.historical ? ' (historique)' : ''}`

  const rows: { label: string; a: string; b: string }[] =
    comparison.status === 'ready'
      ? [
          { label: 'Durée', a: formatDuration(comparison.a), b: formatDuration(comparison.b) },
          { label: 'RDV réels', a: String(comparison.a.realAppointments), b: String(comparison.b.realAppointments) },
          { label: 'RDV / j', a: formatPerDay(comparison.a.appointmentsPerDay), b: formatPerDay(comparison.b.appointmentsPerDay) },
          { label: 'Dépensé', a: `${formatEur(comparison.a.spend)} €`, b: `${formatEur(comparison.b.spend)} €` },
          { label: 'Coût réel / RDV', a: formatCost(comparison.a.realCostPerAppointment), b: formatCost(comparison.b.realCostPerAppointment) },
          ...(isAdmin
            ? [{ label: 'Leads Meta', a: comparison.a.leads === null ? '—' : String(comparison.a.leads), b: comparison.b.leads === null ? '—' : String(comparison.b.leads) }]
            : []),
        ]
      : []

  return (
    <section style={{ marginTop: 30, background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 18 }}>
      <h2 style={{ fontWeight: 600, fontSize: 17 }}>Comparer deux campagnes</h2>
      <p style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
        Durée complète de chaque campagne · écart = A − B (en % de B)
      </p>

      {comparison.status === 'not_enough_campaigns' ? (
        <p style={{ marginTop: 14, fontSize: 13, color: muted }}>Au moins deux campagnes sont nécessaires pour comparer.</p>
      ) : (
        <form method="get" action="/dashboard/comparison" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, marginTop: 14 }}>
          <label style={labelStyle}>
            Campagne A
            <select name="cmp_a" defaultValue={comparison.status === 'incomplete' ? (comparison.a?.id ?? '') : aId} style={selectStyle}>
              <option value="">Choisir…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {optionLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Campagne B
            <select name="cmp_b" defaultValue={comparison.status === 'incomplete' ? (comparison.b?.id ?? '') : bId} style={selectStyle}>
              <option value="">Choisir…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {optionLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            style={{ height: 44, padding: '0 18px', borderRadius: radiusButton, border: `1px solid ${ctaBorder}`, background: 'transparent', color: ink, fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
          >
            Comparer
          </button>
        </form>
      )}

      {comparison.status === 'incomplete' ? (
        <p style={{ marginTop: 12, fontSize: 13, color: muted }}>Sélectionnez deux campagnes à comparer.</p>
      ) : null}
      {comparison.status === 'same' ? (
        <p style={{ marginTop: 12, fontSize: 13, color: muted }}>Choisissez deux campagnes différentes.</p>
      ) : null}

      {comparison.status === 'ready' ? (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(84px, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
              columnGap: 12,
              fontSize: 13,
              background: surfaceAlt,
              borderRadius: 12,
              padding: '4px 12px',
            }}
          >
            <span />
            <span style={{ padding: '8px 0', textAlign: 'right' }}>
              <CampaignHeading side="A" campaign={comparison.a} />
            </span>
            <span style={{ padding: '8px 0', textAlign: 'right' }}>
              <CampaignHeading side="B" campaign={comparison.b} />
            </span>
            {rows.map((row) => (
              <div key={row.label} style={{ display: 'contents' }}>
                <span style={{ padding: '8px 0', borderTop: `1px solid ${line}`, color: muted }}>{row.label}</span>
                <span style={{ padding: '8px 0', borderTop: `1px solid ${line}`, textAlign: 'right', fontWeight: 600 }}>{row.a}</span>
                <span style={{ padding: '8px 0', borderTop: `1px solid ${line}`, textAlign: 'right', fontWeight: 600 }}>{row.b}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <DeltaLine
              label="Écart RDV / j"
              delta={comparison.perDay}
              unavailable={comparison.a.ongoing || comparison.b.ongoing ? 'Indisponible (campagne en cours)' : 'Indisponible'}
              format={(n) => `${formatPerDay(n)} RDV/j`}
              pair={comparison}
            />
            <DeltaLine
              label="Écart coût réel / RDV"
              delta={comparison.cost}
              unavailable="Indisponible"
              format={(n) => formatCost(n)}
              pair={comparison}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}
