'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  appointmentsPerDay,
  campaignDurationDays,
  realAppointments,
  realCostPerAppointment,
  spendPerDay,
} from '@/lib/calculations'
import { accent, faint, formatCost, formatEur, formatPeriod, line, muted, surface, surfaceAlt, radius } from './format'
import OverviewChart, { type OverviewMode } from './OverviewChart'
import EndDateEditor from './EndDateEditor'

type Campaign = {
  id: string
  campaign_number: number
  start_date: string | null
  end_date: string | null
  meta_spend: number
  meta_pixel_leads: number
  manual_appointments_adjustment: number
  calendlyAppointments: number
}

export default function OverviewSection({ campaigns, isAdmin }: { campaigns: Campaign[]; isAdmin: boolean }) {
  const [mode, setMode] = useState<OverviewMode>('total')

  const excludedCount =
    mode === 'day' ? campaigns.filter((c) => campaignDurationDays(c.start_date, c.end_date) === null).length : 0

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <div style={{ display: 'flex', background: surfaceAlt, border: `1px solid ${line}`, borderRadius: 999, padding: 3 }}>
          {(['total', 'day'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                border: 0,
                borderRadius: 999,
                padding: '6px 13px',
                fontSize: 12.5,
                cursor: 'pointer',
                background: mode === m ? surface : 'transparent',
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === 'total' ? 'Totaux' : 'Par jour'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'day' && excludedCount > 0 ? (
        <p style={{ color: muted, fontSize: 12.5, marginBottom: 10 }}>
          {excludedCount} campagne{excludedCount > 1 ? 's' : ''} exclue{excludedCount > 1 ? 's' : ''} du mode Par
          jour (durée non disponible — date de fin non renseignée).
        </p>
      ) : null}

      <div style={{ margin: '10px 0 20px' }}>
        <OverviewChart campaigns={campaigns} mode={mode} />
      </div>

      <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
            gap: 14,
            padding: '10px 18px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.05em',
            textTransform: 'uppercase',
            color: faint,
            background: surfaceAlt,
            borderBottom: `1px solid ${line}`,
          }}
        >
          <span>Campagne</span>
          <span>{mode === 'day' ? 'Dépensé / jour' : 'Dépensé'}</span>
          <span>{mode === 'day' ? 'RDV / jour' : 'RDV Calendly'}</span>
          <span>Coût réel / RDV</span>
        </div>
        {campaigns.map((campaign, index) => {
          const duration = campaignDurationDays(campaign.start_date, campaign.end_date)
          const durationUnavailable = mode === 'day' && duration === null
          const realCount = realAppointments(campaign.calendlyAppointments, campaign.manual_appointments_adjustment)
          const spendValue = mode === 'day' ? spendPerDay(campaign.meta_spend, duration) : campaign.meta_spend
          const appointmentsValue = mode === 'day' ? appointmentsPerDay(realCount, duration) : realCount

          return (
            <div
              key={campaign.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
                gap: 14,
                alignItems: 'center',
                padding: '15px 18px',
                borderTop: index === 0 ? 'none' : `1px solid ${line}`,
              }}
            >
              <div>
                <Link
                  href={`/dashboard/campaigns/${campaign.id}`}
                  style={{ fontWeight: 600, fontSize: 14, color: accent, textDecoration: 'none' }}
                >
                  Campagne {campaign.campaign_number} ›
                </Link>
                <div style={{ color: muted, fontSize: 12, marginTop: 2 }}>
                  {formatPeriod(campaign.start_date, campaign.end_date)}
                </div>
                {isAdmin ? (
                  <EndDateEditor
                    campaignId={campaign.id}
                    startDate={campaign.start_date}
                    initialEndDate={campaign.end_date}
                  />
                ) : null}
              </div>
              {durationUnavailable ? (
                <div style={{ fontSize: 12.5, color: faint, gridColumn: 'span 2' }}>Durée non disponible</div>
              ) : (
                <>
                  <div style={{ fontWeight: 500, fontSize: 15 }}>
                    {spendValue === null ? '—' : `${formatEur(spendValue)} €`}
                  </div>
                  <div style={{ fontWeight: 500, fontSize: 15 }}>
                    {appointmentsValue === null
                      ? '—'
                      : mode === 'day'
                        ? appointmentsValue.toFixed(2).replace('.', ',')
                        : appointmentsValue}
                  </div>
                </>
              )}
              <div style={{ fontWeight: 500, fontSize: 15 }}>
                {formatCost(realCostPerAppointment(campaign.meta_spend, realCount))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
