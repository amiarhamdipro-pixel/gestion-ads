'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  appointmentsPerDay,
  campaignDurationDays,
  metaTrackingRate,
  realAppointments,
  realCostPerAppointment,
  spendPerDay,
} from '@/lib/calculations'
import {
  accent,
  formatCost,
  formatEur,
  formatPct,
  formatPeriod,
  green,
  amber,
  ink,
  red,
  line,
  muted,
  softBg,
  surface,
  surfaceAlt,
  radius,
} from './format'
import OverviewChart, { type MonthlyStatRow, type OverviewMode } from './OverviewChart'
import EndDateEditor from './EndDateEditor'
import PublishToggle from './PublishToggle'

type Campaign = {
  id: string
  campaign_number: number
  start_date: string | null
  end_date: string | null
  published: boolean
  meta_spend: number
  meta_pixel_leads: number
  manual_appointments_adjustment: number
  calendlyAppointments: number
  sync_locked: boolean
}

// Seuils de couleur du badge "Tracking" (part des RDV réels suivis par le
// pixel Meta). Choix de présentation — pas une règle métier nouvelle : la
// valeur elle-même (metaTrackingRate) est la même que le KPI "Tracking Meta".
// color: ink, jamais la teinte elle-même : vert/ambre/rouge sur leur propre
// fond pâle (softBg) tombe autour de 2:1 de contraste, illisible par
// construction (texte et fond dérivés de la même teinte). ink sur un fond
// aussi pâle reste proche du contraste ink/blanc (~17:1) — le badge garde
// son fond coloré (signal visuel conservé), seul le texte devient lisible.
function trackingTone(rate: number | null): { color: string; bg: string } | null {
  if (rate === null) return null
  if (rate >= 0.95) return { color: ink, bg: softBg(green, 0.14) }
  if (rate >= 0.8) return { color: ink, bg: softBg(amber, 0.16) }
  return { color: ink, bg: softBg(red, 0.14) }
}

// État sync_locked (règle métier officielle, voir BRIEF-CLAUDE-CODE.md) :
// "Validée" = verrouillée définitivement, plus jamais synchronisée — jamais
// "Synchronisable", qui suggérerait à tort qu'une action de synchro reste
// possible. Indépendant de published (visibilité client) et visible aux
// deux rôles (même campagne/mêmes libellés pour l'admin et le client).
function LockBadge({ syncLocked }: { syncLocked: boolean }) {
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 999,
        background: syncLocked ? softBg(accent, 0.14) : softBg(green, 0.14),
        color: ink,
        whiteSpace: 'nowrap',
      }}
    >
      {syncLocked ? '🔒 Validée' : '🟢 En préparation'}
    </span>
  )
}

export default function OverviewSection({
  campaigns,
  dailyStats,
  isAdmin,
}: {
  campaigns: Campaign[]
  dailyStats: MonthlyStatRow[]
  isAdmin: boolean
}) {
  const [mode, setMode] = useState<OverviewMode>('total')

  const excludedCount =
    mode === 'day' ? campaigns.filter((c) => campaignDurationDays(c.start_date, c.end_date) === null).length : 0

  // Calculé une seule fois par campagne, consommé par les deux rendus
  // (tableau desktop/tablette, cartes mobile — cf. media query ci-dessous).
  const rows = campaigns.map((campaign) => {
    const duration = campaignDurationDays(campaign.start_date, campaign.end_date)
    const durationUnavailable = mode === 'day' && duration === null
    const realCount = realAppointments(campaign.calendlyAppointments, campaign.manual_appointments_adjustment)
    const spendValue = mode === 'day' ? spendPerDay(campaign.meta_spend, duration) : campaign.meta_spend
    const appointmentsValue = mode === 'day' ? appointmentsPerDay(realCount, duration) : realCount
    const costPerAppt = realCostPerAppointment(campaign.meta_spend, realCount)
    const trackingRate = metaTrackingRate(campaign.meta_pixel_leads, realCount)
    return { campaign, durationUnavailable, spendValue, appointmentsValue, costPerAppt, trackingRate, tone: trackingTone(trackingRate) }
  })

  return (
    <>
      <style>{`
        .amerys-card-list { display: none; }
        @media (max-width: 640px) {
          .amerys-table-wrap { display: none; }
          .amerys-card-list { display: flex; }
        }
      `}</style>

      {mode === 'day' && excludedCount > 0 ? (
        <p style={{ color: muted, fontSize: 12.5, marginBottom: 10 }}>
          {excludedCount} campagne{excludedCount > 1 ? 's' : ''} exclue{excludedCount > 1 ? 's' : ''} du mode Par
          jour (durée non disponible — date de fin non renseignée).
        </p>
      ) : null}

      <div style={{ margin: '0 0 32px' }}>
        <OverviewChart campaigns={campaigns} dailyStats={dailyStats} mode={mode} onModeChange={setMode} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontWeight: 700, fontSize: 17 }}>Campagnes</h2>
      </div>

      {/* Desktop/tablette : tableau complet, avec scroll horizontal en filet de
          sécurité (overflow-x: auto) si jamais l'espace disponible est serré. */}
      <div className="amerys-table-wrap" style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isAdmin ? 720 : 620 }}>
            <thead>
              <tr>
                {[
                  '#',
                  'Campagne',
                  'Période',
                  mode === 'day' ? 'Dépensé / j' : 'Dépensé',
                  mode === 'day' ? 'RDV / j' : 'Rendez-vous',
                  'Coût / RDV réel',
                  ...(isAdmin ? ['Tracking'] : []),
                ].map((label, i) => (
                  <th
                    key={label}
                    style={{
                      textAlign: i === 1 || i === 2 ? 'left' : 'right',
                      padding: '13px 16px',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '.04em',
                      textTransform: 'uppercase',
                      color: muted,
                      background: surfaceAlt,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ campaign, durationUnavailable, spendValue, appointmentsValue, costPerAppt, trackingRate, tone }, index) => (
                <tr key={campaign.id} style={{ borderTop: index === 0 ? 'none' : `1px solid ${line}` }}>
                  <td style={{ padding: '14px 16px', fontSize: 13.5, fontWeight: 700, color: accent, textAlign: 'right' }}>
                    {campaign.campaign_number}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <Link
                      href={`/dashboard/campaigns/${campaign.id}`}
                      style={{ fontWeight: 600, fontSize: 14, color: accent, textDecoration: 'none' }}
                    >
                      Campagne {campaign.campaign_number}
                    </Link>
                    <LockBadge syncLocked={campaign.sync_locked} />
                    {isAdmin ? (
                      <>
                        <EndDateEditor campaignId={campaign.id} startDate={campaign.start_date} initialEndDate={campaign.end_date} />
                        <PublishToggle campaignId={campaign.id} initialPublished={campaign.published} />
                      </>
                    ) : null}
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 13, color: muted, whiteSpace: 'nowrap' }}>
                    {formatPeriod(campaign.start_date, campaign.end_date)}
                  </td>

                  {durationUnavailable ? (
                    <td colSpan={2} style={{ padding: '14px 16px', fontSize: 12.5, color: muted, textAlign: 'right' }}>
                      Durée non disponible
                    </td>
                  ) : (
                    <>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {spendValue === null ? '—' : `${formatEur(spendValue)} €`}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, textAlign: 'right' }}>
                        {appointmentsValue === null
                          ? '—'
                          : mode === 'day'
                            ? appointmentsValue.toFixed(2).replace('.', ',')
                            : appointmentsValue}
                      </td>
                    </>
                  )}

                  <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatCost(costPerAppt)}
                  </td>
                  {isAdmin ? (
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      {tone ? (
                        <span
                          style={{
                            display: 'inline-block',
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: 999,
                            color: tone.color,
                            background: tone.bg,
                          }}
                        >
                          {formatPct(trackingRate)}
                        </span>
                      ) : (
                        <span style={{ color: muted, fontSize: 12.5 }}>—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile (<=640px) : une carte par campagne, aucune coupure horizontale. */}
      <div className="amerys-card-list" style={{ flexDirection: 'column', gap: 12 }}>
        {rows.map(({ campaign, durationUnavailable, spendValue, appointmentsValue, costPerAppt, trackingRate, tone }) => (
          <div key={campaign.id} style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>#{campaign.campaign_number}</span>
              <Link
                href={`/dashboard/campaigns/${campaign.id}`}
                style={{ fontWeight: 600, fontSize: 15, color: accent, textDecoration: 'none' }}
              >
                Campagne {campaign.campaign_number}
              </Link>
              <LockBadge syncLocked={campaign.sync_locked} />
            </div>
            <div style={{ fontSize: 12.5, color: muted, marginTop: 3 }}>{formatPeriod(campaign.start_date, campaign.end_date)}</div>
            {isAdmin ? (
              <>
                <EndDateEditor campaignId={campaign.id} startDate={campaign.start_date} initialEndDate={campaign.end_date} />
                <PublishToggle campaignId={campaign.id} initialPublished={campaign.published} />
              </>
            ) : null}

            {durationUnavailable ? (
              <p style={{ fontSize: 12.5, color: muted, marginTop: 12 }}>Durée non disponible</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                    {mode === 'day' ? 'Dépensé / j' : 'Dépensé'}
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>
                    {spendValue === null ? '—' : `${formatEur(spendValue)} €`}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                    {mode === 'day' ? 'RDV / j' : 'Rendez-vous'}
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>
                    {appointmentsValue === null
                      ? '—'
                      : mode === 'day'
                        ? appointmentsValue.toFixed(2).replace('.', ',')
                        : appointmentsValue}
                  </div>
                </div>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 14,
                paddingTop: 14,
                borderTop: `1px solid ${line}`,
              }}
            >
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}>
                  Coût / RDV réel
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>{formatCost(costPerAppt)}</div>
              </div>
              {isAdmin ? (
                tone ? (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: 999,
                      color: tone.color,
                      background: tone.bg,
                    }}
                  >
                    {formatPct(trackingRate)}
                  </span>
                ) : (
                  <span style={{ color: muted, fontSize: 12.5 }}>Tracking —</span>
                )
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
