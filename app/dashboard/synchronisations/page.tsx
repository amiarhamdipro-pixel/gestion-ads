import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { parisDateToUtcMs } from '@/lib/calculations'
import { accent, amber, ctaBorder, gray, green, indigo, ink, line, muted, radius, radiusButton, red, softBg, surface, surfaceAlt } from '../format'
import {
  PAGE_SIZE,
  STALE_RUNNING_MS,
  STATUS_FILTER_VALUES,
  STATUS_LABEL,
  STEP_STATE_LABEL,
  displayStatus,
  formatDuration,
  formatRunDate,
  isDisplayStatus,
  listCampaigns,
  parseReport,
  requestNowMs,
  stepViews,
  type DisplayStatus,
  type ReportView,
  type StepState,
} from './syncHistory'

// Historique des synchronisations manuelles (admin_sync_runs). Page admin
// uniquement : accès direct par URL sans le rôle admin renvoie vers
// /dashboard (même garde que /dashboard/admin/users). Lecture avec la
// session de l'utilisateur (pas de service_role) : la politique RLS
// admin_sync_runs_select_admin_all filtre aussi côté base.
//
// Paramètres d'URL préfixés sync_ : Sidebar.tsx propage la query string vers
// les autres pages, qui lisent period/from/to — aucun risque de collision.

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const STATUS_COLOR: Record<DisplayStatus, string> = {
  success: green,
  partial: amber,
  failed: red,
  no_campaign: gray,
  running: indigo,
  interrupted: amber,
}

const STEP_STATE_COLOR: Record<StepState, string> = {
  success: green,
  partial: amber,
  failed: red,
  skipped: gray,
  not_reached: gray,
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function validDate(value: string): string | null {
  if (!DATE_PATTERN.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

function Badge({ label, color }: { label: string; color: string }) {
  // Texte ink sur fond softBg (même principe que admin/users/page.tsx) :
  // red/green sur leur propre fond pâle manquent de contraste.
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: ink,
        background: softBg(color, 0.14),
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 13 }}>
      <span style={{ color: muted }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: surfaceAlt, borderRadius: 12, padding: '12px 14px' }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: accent, marginBottom: 6 }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function RunDetail({ report, status }: { report: ReportView | null; status: DisplayStatus }) {
  if (!report) {
    return (
      <p style={{ fontSize: 13, color: muted }}>
        {status === 'interrupted'
          ? "Aucun rapport enregistré : l'exécution ne s'est pas terminée normalement (arrêt du serveur, délai dépassé ou coupure). Son statut reste « en cours » en base."
          : status === 'running'
            ? 'Synchronisation en cours : le rapport sera disponible à la fin de l’exécution.'
            : 'Aucun rapport enregistré pour cette exécution.'}
      </p>
    )
  }

  const t = report.metaTotals
  const d = report.metaDaily
  const a = report.calendlyAppointments
  const c = report.calendlyDaily

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="amerys-sync-detail-grid">
        <Section title="Étapes exécutées">
          {stepViews(report).map((step) => (
            <Row key={step.label} label={step.label} value={<Badge label={STEP_STATE_LABEL[step.state]} color={STEP_STATE_COLOR[step.state]} />} />
          ))}
        </Section>

        <Section title="Résultats Meta">
          {t ? (
            <>
              <Row
                label="Campagne traitée"
                value={t.targetCampaignNumber === null ? 'Aucune candidate' : `n°${t.targetCampaignNumber} · ${t.failed > 0 ? 'échec' : 'synchronisée'}`}
              />
              <Row
                label="Quotidien"
                value={d ? (d.error ? 'échec' : d.failed > 0 ? 'échec' : `${d.daysUpserted} jour${d.daysUpserted > 1 ? 's' : ''} mis à jour`) : 'non lancé'}
              />
              <Row label="Verrouillées ignorées" value={listCampaigns(t.skippedLocked)} />
              <Row label="En attente" value={listCampaigns(t.waiting)} />
            </>
          ) : (
            <p style={{ fontSize: 13, color: muted }}>Aucun résultat Meta enregistré.</p>
          )}
        </Section>

        <Section title="Résultats Calendly">
          {a ? (
            <>
              <Row label="Rendez-vous lus" value={a.read} />
              <Row label="Détails interrogés" value={a.invitees} />
              <Row label="Retenus (Meta)" value={a.retained} />
              <Row label="Ambigus (chevauchement)" value={a.ambiguous} />
              <Row label="En erreur" value={Math.max(0, a.errors - a.ambiguous)} />
              <Row label="Quotidien" value={c ? (c.error ? 'échec' : `${c.daysWritten} jour${c.daysWritten > 1 ? 's' : ''} recalculé${c.daysWritten > 1 ? 's' : ''}`) : 'non lancé'} />
            </>
          ) : (
            <p style={{ fontSize: 13, color: muted }}>
              {report.noCampaignToSync ? 'Non lancé : aucune campagne à synchroniser.' : 'Aucun résultat Calendly enregistré.'}
            </p>
          )}
        </Section>
      </div>

      <Section title={`Erreurs et causes identifiées (${report.totalErrors} au total)`}>
        {report.diagnostics.length === 0 ? (
          <p style={{ fontSize: 13, color: muted }}>
            {status === 'failed' || status === 'partial' ? 'Aucune cause enregistrée pour cette exécution.' : 'Aucune erreur.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {report.diagnostics.map((diag, i) => (
              <li key={i} style={{ fontSize: 13, borderTop: i === 0 ? 'none' : `1px solid ${line}`, paddingTop: i === 0 ? 0 : 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <strong>{diag.step}</strong>
                  <Badge label={diag.blocking ? 'Bloquant' : 'Partiel'} color={diag.blocking ? red : amber} />
                </div>
                <div style={{ marginTop: 4 }}>
                  {diag.cause}
                  {diag.code ? ` (${diag.code})` : ''}
                  {diag.occurrences > 1 ? ` · ${diag.occurrences} occurrences` : ''}
                </div>
                <div style={{ marginTop: 2, color: muted }}>Conséquence : {diag.consequence}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

export default async function SynchronisationsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()

  if (profile?.role !== 'admin') {
    redirect('/dashboard')
  }

  const params = await searchParams
  const fromDate = validDate(single(params.sync_from))
  const toDate = validDate(single(params.sync_to))
  const clientFilter = UUID_PATTERN.test(single(params.sync_client)) ? single(params.sync_client) : ''
  const statusParam = single(params.sync_status)
  const statusFilter: DisplayStatus | '' = isDisplayStatus(statusParam) ? statusParam : ''
  const page = Math.max(1, Math.floor(Number(single(params.sync_page)) || 1))

  // Instant de référence unique pour le filtre et l'affichage « interrompue ».
  const nowMs = requestNowMs()
  const staleThresholdIso = new Date(nowMs - STALE_RUNNING_MS).toISOString()

  let query = supabase
    .from('admin_sync_runs')
    .select('id, client_id, status, target_campaign_number, report, started_at, duration_ms', { count: 'exact' })
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })

  if (clientFilter) query = query.eq('client_id', clientFilter)
  if (fromDate) query = query.gte('started_at', new Date(parisDateToUtcMs(fromDate, 0, 0, 0)).toISOString())
  if (toDate) query = query.lt('started_at', new Date(parisDateToUtcMs(nextDay(toDate), 0, 0, 0)).toISOString())
  if (statusFilter === 'interrupted') {
    query = query.eq('status', 'running').lt('started_at', staleThresholdIso)
  } else if (statusFilter === 'running') {
    query = query.eq('status', 'running').gte('started_at', staleThresholdIso)
  } else if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const offset = (page - 1) * PAGE_SIZE
  const [{ data: runs, count, error }, { data: clientsRaw }] = await Promise.all([
    query.range(offset, offset + PAGE_SIZE - 1),
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
  ])

  const clients = clientsRaw ?? []
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]))

  // PGRST103 : page demandée au-delà du dernier résultat -> traitée comme vide.
  const outOfRange = error?.code === 'PGRST103'
  const readError = error && !outOfRange ? error : null
  const tableMissing = readError?.code === 'PGRST205' || readError?.code === '42P01'

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(fromDate || toDate || clientFilter || statusFilter)

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams()
    if (fromDate) qs.set('sync_from', fromDate)
    if (toDate) qs.set('sync_to', toDate)
    if (clientFilter) qs.set('sync_client', clientFilter)
    if (statusFilter) qs.set('sync_status', statusFilter)
    if (targetPage > 1) qs.set('sync_page', String(targetPage))
    const s = qs.toString()
    return s ? `/dashboard/synchronisations?${s}` : '/dashboard/synchronisations'
  }

  const fieldStyle: React.CSSProperties = {
    height: 44,
    padding: '0 10px',
    borderRadius: radiusButton,
    border: `1px solid ${line}`,
    background: surface,
    color: ink,
    font: 'inherit',
    fontSize: 13,
  }
  const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, fontWeight: 600, color: muted }

  return (
    <main className="amerys-sync-main" style={{ padding: '40px 40px 64px' }}>
      <style>{`
        .amerys-sync-summary {
          display: grid;
          grid-template-columns: 1.3fr 1.2fr 1.3fr .7fr .7fr 20px;
          gap: 12px;
          align-items: center;
          padding: 14px 16px;
          cursor: pointer;
          list-style: none;
        }
        .amerys-sync-summary::-webkit-details-marker { display: none; }
        .amerys-sync-cell-label { display: none; }
        .amerys-sync-chevron { transition: transform .2s; color: ${muted}; }
        details[open] .amerys-sync-chevron { transform: rotate(180deg); }
        .amerys-sync-detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .amerys-sync-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
        @media (max-width: 1024px) {
          .amerys-sync-detail-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 760px) {
          .amerys-sync-main { padding: 24px 16px 48px !important; }
          .amerys-sync-head { display: none !important; }
          .amerys-sync-summary { grid-template-columns: 1fr 1fr; gap: 10px; }
          .amerys-sync-cell-label { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: ${muted}; margin-bottom: 2px; }
          .amerys-sync-chevron { display: none; }
          .amerys-sync-filters > * { flex: 1 1 140px; }
        }
      `}</style>

      <h1 style={{ fontWeight: 560, fontSize: 28, letterSpacing: '-.015em' }}>Synchronisations</h1>
      <p style={{ color: muted, fontSize: 13.5, marginTop: 5 }}>Historique des synchronisations manuelles Meta + Calendly</p>

      <form
        method="get"
        action="/dashboard/synchronisations"
        className="amerys-sync-filters"
        style={{ marginTop: 24, marginBottom: 20, background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 16 }}
      >
        <label style={labelStyle}>
          Du
          <input type="date" name="sync_from" defaultValue={fromDate ?? ''} style={fieldStyle} />
        </label>
        <label style={labelStyle}>
          Au
          <input type="date" name="sync_to" defaultValue={toDate ?? ''} style={fieldStyle} />
        </label>
        <label style={labelStyle}>
          Client
          <select name="sync_client" defaultValue={clientFilter} style={fieldStyle}>
            <option value="">Tous les clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Statut
          <select name="sync_status" defaultValue={statusFilter} style={fieldStyle}>
            <option value="">Tous les statuts</option>
            {STATUS_FILTER_VALUES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          style={{ height: 44, padding: '0 18px', borderRadius: radiusButton, border: `1px solid ${ctaBorder}`, background: 'transparent', color: ink, fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
        >
          Filtrer
        </button>
        {hasFilters ? (
          <Link href="/dashboard/synchronisations" style={{ alignSelf: 'center', fontSize: 13, color: indigo, fontWeight: 600 }}>
            Réinitialiser
          </Link>
        ) : null}
      </form>

      {readError ? (
        <div role="alert" style={{ background: surface, border: `1px solid ${softBg(red, 0.4)}`, borderRadius: radius, padding: 20, fontSize: 13.5 }}>
          <strong>Impossible de lire l’historique des synchronisations.</strong>
          <p style={{ color: muted, marginTop: 6 }}>
            {tableMissing
              ? 'La table d’historique n’est pas encore installée sur la base (migration admin_sync_runs à appliquer).'
              : 'Réessayez dans quelques instants. Si le problème persiste, consultez les journaux serveur.'}
          </p>
        </div>
      ) : (runs ?? []).length === 0 ? (
        <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, padding: 28, textAlign: 'center', fontSize: 13.5, color: muted }}>
          {outOfRange ? (
            <>
              Cette page ne contient aucun résultat.{' '}
              <Link href={pageHref(1)} style={{ color: indigo, fontWeight: 600 }}>
                Revenir à la première page
              </Link>
            </>
          ) : hasFilters ? (
            'Aucune synchronisation ne correspond à ces filtres.'
          ) : (
            'Aucune synchronisation enregistrée pour le moment.'
          )}
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>
            {total} synchronisation{total > 1 ? 's' : ''} · page {page} sur {totalPages}
          </p>

          <div style={{ background: surface, border: `1px solid ${line}`, borderRadius: radius, overflow: 'hidden' }}>
            <div
              className="amerys-sync-summary amerys-sync-head"
              style={{ cursor: 'default', background: surfaceAlt, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: muted }}
            >
              <span>Date et heure</span>
              <span>Client</span>
              <span>Statut</span>
              <span>Durée</span>
              <span>Campagne</span>
              <span />
            </div>

            {(runs ?? []).map((run, index) => {
              const status = displayStatus(run.status, run.started_at, nowMs)
              const report = parseReport(run.report)
              return (
                <details key={run.id} style={{ borderTop: index === 0 ? 'none' : `1px solid ${line}` }}>
                  <summary className="amerys-sync-summary" style={{ fontSize: 13.5 }}>
                    <span>
                      <span className="amerys-sync-cell-label">Date</span>
                      {formatRunDate(run.started_at)}
                    </span>
                    <span>
                      <span className="amerys-sync-cell-label">Client</span>
                      {clientNameById.get(run.client_id) ?? 'Client inconnu'}
                    </span>
                    <span>
                      <span className="amerys-sync-cell-label">Statut</span>
                      <Badge label={STATUS_LABEL[status]} color={STATUS_COLOR[status]} />
                    </span>
                    <span>
                      <span className="amerys-sync-cell-label">Durée</span>
                      {formatDuration(run.duration_ms)}
                    </span>
                    <span>
                      <span className="amerys-sync-cell-label">Campagne</span>
                      {run.target_campaign_number === null ? '—' : `n°${run.target_campaign_number}`}
                    </span>
                    <svg className="amerys-sync-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <div style={{ padding: '4px 16px 16px' }}>
                    <RunDetail report={report} status={status} />
                  </div>
                </details>
              )
            })}
          </div>

          {totalPages > 1 ? (
            <nav aria-label="Pagination" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 18, fontSize: 13 }}>
              {page > 1 ? (
                <Link href={pageHref(page - 1)} style={{ color: indigo, fontWeight: 600 }}>
                  ← Précédent
                </Link>
              ) : (
                <span style={{ color: muted }}>← Précédent</span>
              )}
              <span style={{ color: muted }}>
                Page {page} sur {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={pageHref(page + 1)} style={{ color: indigo, fontWeight: 600 }}>
                  Suivant →
                </Link>
              ) : (
                <span style={{ color: muted }}>Suivant →</span>
              )}
            </nav>
          ) : null}
        </>
      )}
    </main>
  )
}
