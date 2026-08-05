// Import idempotent des données historiques (campagnes 1 à 12) depuis un
// classeur Excel externe — jamais modifié/déplacé/supprimé, lu en lecture
// seule via scripts/parse-xlsx.ps1 (aucune dépendance npm ajoutée : un
// .xlsx est une archive ZIP de XML, extraite via les outils Windows déjà
// disponibles). Voir BRIEF-CLAUDE-CODE.md : "Les campagnes historiques sont
// désormais alimentées par import Excel. Le dernier fichier importé est
// toujours la source de vérité."
//
// Usage :
//   npx tsx --env-file=.env scripts/import-historical-excel.ts <chemin.xlsx> [--dry-run]
//
// Idempotence — chaque table est retrouvée par une clé métier stable, jamais
// par un upsert sur une clé synthétique qui risquerait de dupliquer une ligne
// déjà créée par une VRAIE synchro Meta antérieure (campagnes 1 à 12 ayant
// déjà, pour certaines, une vraie ligne audiences/videos historique — voir
// campagne n°12) :
//   - campaigns  : (client_id, campaign_number)
//   - audiences  : (campaign_id, audience_type) — au plus 2 par campagne
//   - videos     : audience_id — au plus 1 par audience
// Une ligne déjà connue est mise à jour (UPDATE by id) ; une ligne absente
// est créée avec une clé technique synthétique stable ("excel-import:...",
// jamais un vrai id Meta inventé) pour ne jamais entrer en collision avec un
// futur id réel. Un ré-import du même fichier retrouve donc toujours les
// mêmes lignes : aucun doublon, quel que soit le nombre de passages.
//
// "Cellule vide = NULL, jamais 0" : voir stringCell/numberCell ci-dessous —
// une cellule absente du fichier ne produit jamais de valeur par défaut
// inventée, seulement null.

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createAdminClient } from '../lib/supabase/admin'

const CLIENT_SLUG = 'mcc'
// Périmètre strict de cet incrément (voir en-tête BRIEF-CLAUDE-CODE.md) :
// toute ligne hors 1..12 arrête l'import plutôt que de le traiter en
// silence — les campagnes 13+ ne doivent jamais être touchées par ce script.
const MAX_CAMPAIGN_NUMBER = 12

type Supa = ReturnType<typeof createAdminClient>

type CellKind = 'string' | 'number' | 'date-serial' | 'bool' | 'formula-string' | 'error'
type Cell = { col: number; ref: string; kind: CellKind; value: string | number | boolean }
type SheetRow = { row: number; cells: Cell[] }
type SheetData = { sheetName: string; rows: SheetRow[] }

const EXPECTED_HEADERS = [
  'Campagne', 'Date debut', 'Date fin', 'RDV Calendly', 'Montant Campagne',
  'Video Barber', 'Leads Barber', 'CPL Barber', 'Depenses Barber', 'Facebook Barber', 'Instagram Barber',
  'Vues Barber', 'Lecture Barber (s)', 'Accroche Barber %', 'Retention Barber %',
  'Video Coiffeur', 'Leads Coiffeur', 'CPL Coiffeur', 'Depenses Coiffeur', 'Facebook Coiffeur', 'Instagram Coiffeur',
  'Vues Coiffeur', 'Lecture Coiffeur (s)', 'Accroche Coiffeur %', 'Retention Coiffeur %',
] as const

// ─── Lecture brute du classeur (PowerShell, voir parse-xlsx.ps1) ──────────

function readSheet(xlsxPath: string): SheetData {
  const outJson = join(tmpdir(), `xlsx-parsed-${randomUUID()}.json`)
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', join(__dirname, 'parse-xlsx.ps1'),
        '-XlsxPath', xlsxPath,
        '-OutJson', outJson,
      ],
      { stdio: 'pipe' }
    )
    // Windows PowerShell 5.1 : Out-File -Encoding utf8 écrit toujours un BOM
    // (pas de utf8NoBOM disponible avant PowerShell 6+, voir parse-xlsx.ps1)
    // — retiré ici avant JSON.parse.
    let raw = readFileSync(outJson, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    return JSON.parse(raw) as SheetData
  } finally {
    try {
      unlinkSync(outJson)
    } catch {
      // Fichier temporaire déjà absent — rien à faire.
    }
  }
}

function buildHeaderIndex(sheet: SheetData): Map<string, number> {
  const headerRow = sheet.rows.find((r) => r.row === 1)
  if (!headerRow) throw new Error("Ligne d'en-tête (row 1) introuvable dans le classeur.")

  const index = new Map<string, number>()
  for (const cell of headerRow.cells) {
    if (typeof cell.value === 'string') index.set(cell.value.trim(), cell.col)
  }
  for (const expected of EXPECTED_HEADERS) {
    if (!index.has(expected)) {
      throw new Error(
        `Colonne attendue absente du fichier : "${expected}". En-têtes trouvées : ${[...index.keys()].join(', ')}`
      )
    }
  }
  return index
}

function cellAt(row: SheetRow, col: number): Cell | undefined {
  return row.cells.find((c) => c.col === col)
}

function stringCell(row: SheetRow, headerIndex: Map<string, number>, header: string): string | null {
  const cell = cellAt(row, headerIndex.get(header)!)
  if (!cell) return null
  if (typeof cell.value === 'string') {
    const trimmed = cell.value.trim()
    return trimmed === '' ? null : trimmed
  }
  throw new Error(`Cellule ${cell.ref} (ligne ${row.row}) : texte attendu pour "${header}", trouvé ${cell.kind}.`)
}

// Accepte kind='number' ET kind='string' numérique (quirk réel observé dans
// le fichier source : certaines cellules "Vues" sont stockées en texte —
// même valeur, type de cellule Excel différent, aucune invention). Cellule
// absente => null, jamais 0.
function numberCell(row: SheetRow, headerIndex: Map<string, number>, header: string): number | null {
  const cell = cellAt(row, headerIndex.get(header)!)
  if (!cell) return null
  if (cell.kind === 'number') return cell.value as number
  if (cell.kind === 'string') {
    const parsed = Number((cell.value as string).trim())
    if (!Number.isNaN(parsed)) return parsed
  }
  throw new Error(`Cellule ${cell.ref} (ligne ${row.row}) : nombre attendu pour "${header}", trouvé ${cell.kind}="${cell.value}".`)
}

function requiredNumberCell(row: SheetRow, headerIndex: Map<string, number>, header: string): number {
  const value = numberCell(row, headerIndex, header)
  if (value === null) throw new Error(`Ligne ${row.row} : colonne "${header}" requise mais absente/vide.`)
  return value
}

// ─── Modèle des lignes ──────────────────────────────────────────────────

type AudienceCols = {
  videoName: string | null
  leads: number
  depenses: number
  facebook: number | null
  instagram: number | null
  vues: number | null
  lectureSeconds: number | null
  accrochePct: number | null
  retentionPct: number | null
}

type ParsedRow = {
  sourceRow: number
  campaignNumber: number
  startMonthDay: string // "MM-DD", année pas encore déterminée
  endMonthDay: string
  rdvCalendly: number
  montantCampagne: number
  barbier: AudienceCols
  coiffeur: AudienceCols
}

function parseDdMm(raw: string, cellRef: string): string {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!match) throw new Error(`Cellule ${cellRef} : date "${raw}" ne correspond pas au format attendu JJ/MM.`)
  return `${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function parseAudience(row: SheetRow, headerIndex: Map<string, number>, prefix: 'Barber' | 'Coiffeur'): AudienceCols {
  const videoHeader = prefix === 'Barber' ? 'Video Barber' : 'Video Coiffeur'
  return {
    videoName: stringCell(row, headerIndex, videoHeader),
    leads: requiredNumberCell(row, headerIndex, `Leads ${prefix}`),
    depenses: requiredNumberCell(row, headerIndex, `Depenses ${prefix}`),
    facebook: numberCell(row, headerIndex, `Facebook ${prefix}`),
    instagram: numberCell(row, headerIndex, `Instagram ${prefix}`),
    vues: numberCell(row, headerIndex, `Vues ${prefix}`),
    lectureSeconds: numberCell(row, headerIndex, `Lecture ${prefix} (s)`),
    accrochePct: numberCell(row, headerIndex, `Accroche ${prefix} %`),
    retentionPct: numberCell(row, headerIndex, `Retention ${prefix} %`),
  }
}

function parseRows(sheet: SheetData, headerIndex: Map<string, number>): ParsedRow[] {
  const dataRows = sheet.rows.filter((r) => r.row >= 2).sort((a, b) => a.row - b.row)
  const parsed: ParsedRow[] = []

  for (const row of dataRows) {
    const campagneRaw = stringCell(row, headerIndex, 'Campagne')
    if (!campagneRaw) continue // ligne vide en fin de feuille, ignorée.

    const match = campagneRaw.match(/^KPI0*([1-9]\d*)$/i)
    if (!match) throw new Error(`Ligne ${row.row} : "Campagne" = "${campagneRaw}" ne correspond pas au format attendu "KPI0N".`)
    const campaignNumber = Number(match[1])

    if (campaignNumber > MAX_CAMPAIGN_NUMBER) {
      throw new Error(
        `Ligne ${row.row} : campagne n°${campaignNumber} hors périmètre de cet incrément ` +
          `(1 à ${MAX_CAMPAIGN_NUMBER} uniquement) — import arrêté, aucune écriture effectuée. ` +
          `Les campagnes 13+ ne doivent jamais être touchées par ce script.`
      )
    }

    const startRaw = stringCell(row, headerIndex, 'Date debut')
    const endRaw = stringCell(row, headerIndex, 'Date fin')
    if (!startRaw || !endRaw) throw new Error(`Ligne ${row.row} (campagne n°${campaignNumber}) : date de début/fin manquante.`)

    parsed.push({
      sourceRow: row.row,
      campaignNumber,
      startMonthDay: parseDdMm(startRaw, `B${row.row}`),
      endMonthDay: parseDdMm(endRaw, `C${row.row}`),
      rdvCalendly: requiredNumberCell(row, headerIndex, 'RDV Calendly'),
      montantCampagne: requiredNumberCell(row, headerIndex, 'Montant Campagne'),
      barbier: parseAudience(row, headerIndex, 'Barber'),
      coiffeur: parseAudience(row, headerIndex, 'Coiffeur'),
    })
  }

  return parsed
}

// ─── Détermination automatique des années ──────────────────────────────
//
// Le fichier ne donne jamais l'année (JJ/MM uniquement). Aucune année n'est
// devinée : elle est dérivée de deux faits vérifiables uniquement —
// (1) l'ordre chronologique des lignes (KPI01 = la plus ancienne, un
// nouveau cycle d'année ne commence que lorsque le mois de début d'une
// ligne redescend sous le mois de fin de la ligne précédente — signe non
// ambigu d'un passage au 1er janvier) et (2) la date de début RÉELLE
// (source Meta, déjà en base) de la toute première campagne qui suit
// directement la dernière ligne du fichier, utilisée comme unique ancre.
// Si cette ancre est absente ou que la comparaison reste ambiguë, l'import
// s'arrête et le signale — jamais de repli sur une année devinée.
function monthOf(monthDay: string): number {
  return Number(monthDay.slice(0, 2))
}

function inferYears(
  rows: { startMonthDay: string; endMonthDay: string }[],
  anchor: { year: number; month: number; day: number }
): number[] {
  const offsets: number[] = [0]
  for (let i = 1; i < rows.length; i++) {
    const prevEndMonth = monthOf(rows[i - 1].endMonthDay)
    const curStartMonth = monthOf(rows[i].startMonthDay)
    offsets.push(curStartMonth < prevEndMonth ? offsets[i - 1] + 1 : offsets[i - 1])
  }

  const last = rows[rows.length - 1]
  const [lastEndMonth, lastEndDay] = last.endMonthDay.split('-').map(Number)

  let lastRowYear: number
  if (lastEndMonth < anchor.month || (lastEndMonth === anchor.month && lastEndDay < anchor.day)) {
    lastRowYear = anchor.year
  } else if (lastEndMonth > anchor.month) {
    lastRowYear = anchor.year - 1
  } else {
    throw new Error(
      `Ambiguïté réelle sur l'année : la dernière ligne du fichier (fin ${last.endMonthDay}) ne peut pas être ` +
        `positionnée sans ambiguïté par rapport à la campagne suivante réelle (début ${anchor.year}-` +
        `${String(anchor.month).padStart(2, '0')}-${String(anchor.day).padStart(2, '0')}). Import arrêté, aucune écriture effectuée.`
    )
  }

  const lastOffset = offsets[offsets.length - 1]
  const years = offsets.map((offset) => lastRowYear - (lastOffset - offset))

  // Garde-fou générique (au-delà du cas ci-dessus) : la séquence de dates de
  // fin doit rester non décroissante une fois les années assignées — sinon
  // l'algorithme a mal détecté un passage d'année quelque part.
  for (let i = 1; i < rows.length; i++) {
    const prevEnd = `${years[i - 1]}-${rows[i - 1].endMonthDay}`
    const curEnd = `${years[i]}-${rows[i].endMonthDay}`
    if (curEnd < prevEnd) {
      throw new Error(
        `Ambiguïté réelle sur l'année : la séquence de dates de fin déduite n'est pas chronologiquement croissante ` +
          `(ligne ${i} : ${prevEnd} -> ${curEnd}). Import arrêté, aucune écriture effectuée.`
      )
    }
  }

  return years
}

// ─── Résolution DB ──────────────────────────────────────────────────────

async function resolveClientId(supabase: Supa): Promise<string> {
  const { data, error } = await supabase.from('clients').select('id').eq('slug', CLIENT_SLUG).single()
  if (error || !data) throw new Error(`Client "${CLIENT_SLUG}" introuvable : ${error?.message ?? 'aucune ligne'}`)
  return data.id
}

// Ancre de détermination des années : la toute première campagne réelle
// (Meta) qui suit le périmètre de ce fichier (MAX_CAMPAIGN_NUMBER + 1).
async function resolveAnchor(supabase: Supa, clientId: string): Promise<{ year: number; month: number; day: number }> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('campaign_number, start_date')
    .eq('client_id', clientId)
    .eq('campaign_number', MAX_CAMPAIGN_NUMBER + 1)
    .maybeSingle()

  if (error) throw new Error(`Échec lecture campagne d'ancrage n°${MAX_CAMPAIGN_NUMBER + 1} : ${error.message}`)
  if (!data || !data.start_date) {
    throw new Error(
      `Impossible de déterminer automatiquement les années : la campagne n°${MAX_CAMPAIGN_NUMBER + 1} ` +
        `(ancre nécessaire, doit suivre directement la dernière ligne du fichier) est absente ou sans start_date en base. ` +
        `Import arrêté, aucune écriture effectuée.`
    )
  }
  const [year, month, day] = data.start_date.split('-').map(Number)
  return { year, month, day }
}

type CampaignUpsertResult = { id: string; created: boolean }

async function upsertCampaign(
  supabase: Supa,
  clientId: string,
  row: ParsedRow,
  startDate: string,
  endDate: string,
  dryRun: boolean
): Promise<CampaignUpsertResult> {
  const { data: existing, error: selectError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('client_id', clientId)
    .eq('campaign_number', row.campaignNumber)
    .maybeSingle()
  if (selectError) throw new Error(`Échec lecture campagne n°${row.campaignNumber} : ${selectError.message}`)

  const metaPixelLeads = row.barbier.leads + row.coiffeur.leads

  const { count: activeCount, error: countError } = existing
    ? await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', existing.id)
        .eq('status', 'active')
    : { count: 0, error: null }
  if (countError) throw new Error(`Échec comptage rendez-vous réels campagne n°${row.campaignNumber} : ${countError.message}`)

  const manualAdjustment = row.rdvCalendly - (activeCount ?? 0)

  if (existing) {
    if (!dryRun) {
      const { error } = await supabase
        .from('campaigns')
        .update({
          start_date: startDate,
          end_date: endDate,
          meta_spend: row.montantCampagne,
          meta_pixel_leads: metaPixelLeads,
          calendly_appointments: row.rdvCalendly,
          manual_appointments_adjustment: manualAdjustment,
          sync_locked: true,
        })
        .eq('id', existing.id)
      if (error) throw new Error(`Échec mise à jour campagne n°${row.campaignNumber} : ${error.message}`)
    }
    return { id: existing.id, created: false }
  }

  if (dryRun) return { id: `dry-run:campaign-${row.campaignNumber}`, created: true }

  const { data: inserted, error: insertError } = await supabase
    .from('campaigns')
    .insert({
      client_id: clientId,
      // Placeholder technique explicite, jamais un id Meta réel inventé :
      // ce cas ne se produit que si la campagne n'existait pas du tout
      // avant cet import (aucune campagne 1-12 actuelle n'est dans ce cas).
      meta_campaign_id: `excel-import:campaign-${row.campaignNumber}`,
      campaign_number: row.campaignNumber,
      name: `Campagne n°${row.campaignNumber}`,
      start_date: startDate,
      end_date: endDate,
      meta_spend: row.montantCampagne,
      meta_pixel_leads: metaPixelLeads,
      calendly_appointments: row.rdvCalendly,
      manual_appointments_adjustment: manualAdjustment,
      sync_locked: true,
    })
    .select('id')
    .single()
  if (insertError || !inserted) throw new Error(`Échec création campagne n°${row.campaignNumber} : ${insertError?.message}`)
  return { id: inserted.id, created: true }
}

async function upsertAudience(
  supabase: Supa,
  campaignId: string,
  campaignNumber: number,
  audienceType: 'barbier' | 'coiffeur',
  cols: AudienceCols,
  dryRun: boolean
): Promise<string> {
  // En dry-run, une campagne inexistante n'a pas de vrai id (uuid) à
  // interroger : on simule directement une création, sans appel DB.
  if (campaignId.startsWith('dry-run:')) return `dry-run:audience-${campaignNumber}-${audienceType}`

  const { data: existing, error: selectError } = await supabase
    .from('audiences')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('audience_type', audienceType)
    .maybeSingle()
  if (selectError) throw new Error(`Échec lecture audience ${audienceType} campagne n°${campaignNumber} : ${selectError.message}`)

  const payload = {
    meta_spend: cols.depenses,
    meta_pixel_leads: cols.leads,
    facebook_leads: cols.facebook,
    instagram_leads: cols.instagram,
  }

  if (existing) {
    if (!dryRun) {
      const { error } = await supabase.from('audiences').update(payload).eq('id', existing.id)
      if (error) throw new Error(`Échec mise à jour audience ${audienceType} campagne n°${campaignNumber} : ${error.message}`)
    }
    return existing.id
  }

  if (dryRun) return `dry-run:audience-${campaignNumber}-${audienceType}`

  const label = audienceType === 'barbier' ? 'Barbier' : 'Coiffeur'
  const { data: inserted, error: insertError } = await supabase
    .from('audiences')
    .insert({
      campaign_id: campaignId,
      meta_adset_id: `excel-import:campaign-${campaignNumber}:${audienceType}`,
      audience_type: audienceType,
      name: `${label} (import historique)`,
      ...payload,
    })
    .select('id')
    .single()
  if (insertError || !inserted) throw new Error(`Échec création audience ${audienceType} campagne n°${campaignNumber} : ${insertError?.message}`)
  return inserted.id
}

async function upsertVideo(
  supabase: Supa,
  audienceId: string,
  campaignNumber: number,
  audienceType: 'barbier' | 'coiffeur',
  cols: AudienceCols,
  dryRun: boolean
): Promise<void> {
  // Même garde qu'upsertAudience ci-dessus : pas de vrai id à interroger en
  // dry-run pour une audience simulée.
  if (audienceId.startsWith('dry-run:')) return

  const { data: existing, error: selectError } = await supabase
    .from('videos')
    .select('id')
    .eq('audience_id', audienceId)
    .maybeSingle()
  if (selectError) throw new Error(`Échec lecture vidéo ${audienceType} campagne n°${campaignNumber} : ${selectError.message}`)

  // video_plays/average_watch_time_seconds sont NOT NULL : la colonne
  // "Vues"/"Lecture (s)" est présente sur toutes les lignes du fichier
  // observées (voir requiredNumberCell) — si absente pour une ligne future,
  // l'import s'arrête plutôt que d'écrire une valeur inventée.
  if (cols.vues === null) throw new Error(`Campagne n°${campaignNumber}, audience ${audienceType} : "Vues" manquant (colonne requise).`)
  if (cols.lectureSeconds === null) throw new Error(`Campagne n°${campaignNumber}, audience ${audienceType} : "Lecture (s)" manquant (colonne requise).`)

  const hookRatePct = cols.accrochePct !== null ? cols.accrochePct / 100 : null
  const retentionRatePct = cols.retentionPct !== null ? cols.retentionPct / 100 : null

  if (existing) {
    if (!dryRun) {
      const { error } = await supabase
        .from('videos')
        .update({
          name: cols.videoName ?? undefined,
          video_plays: cols.vues,
          average_watch_time_seconds: cols.lectureSeconds,
          hook_rate_pct: hookRatePct,
          retention_rate_pct: retentionRatePct,
        })
        .eq('id', existing.id)
      if (error) throw new Error(`Échec mise à jour vidéo ${audienceType} campagne n°${campaignNumber} : ${error.message}`)
    }
    return
  }

  if (dryRun) return

  const { error: insertError } = await supabase.from('videos').insert({
    audience_id: audienceId,
    meta_ad_id: `excel-import:campaign-${campaignNumber}:${audienceType}:video`,
    name: cols.videoName ?? 'Vidéo',
    video_display_name: null,
    video_plays: cols.vues,
    average_watch_time_seconds: cols.lectureSeconds,
    impressions: null,
    video_plays_3s: null,
    thruplays: null,
    video_p25: null,
    video_p50: null,
    video_p75: null,
    video_p100: null,
    hook_rate_pct: hookRatePct,
    retention_rate_pct: retentionRatePct,
  })
  if (insertError) throw new Error(`Échec création vidéo ${audienceType} campagne n°${campaignNumber} : ${insertError.message}`)
}

// ─── Orchestration ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const xlsxPathArg = args.find((a) => !a.startsWith('--'))
  if (!xlsxPathArg) throw new Error('Usage : import-historical-excel.ts <chemin.xlsx> [--dry-run]')
  const xlsxPath = resolve(xlsxPathArg)

  console.log(`Lecture (seule) du classeur : ${xlsxPath}`)
  const sheet = readSheet(xlsxPath)
  const headerIndex = buildHeaderIndex(sheet)
  const rows = parseRows(sheet, headerIndex)
  console.log(`${rows.length} ligne(s) de campagne trouvée(s) (feuille "${sheet.sheetName}").`)

  const supabase = createAdminClient()
  const clientId = await resolveClientId(supabase)
  const anchor = await resolveAnchor(supabase, clientId)
  console.log(`Ancre de détermination des années : campagne n°${MAX_CAMPAIGN_NUMBER + 1}, début ${anchor.year}-${String(anchor.month).padStart(2, '0')}-${String(anchor.day).padStart(2, '0')}.`)

  const years = inferYears(rows, anchor)

  console.log(dryRun ? '--- MODE DRY-RUN : aucune écriture ne sera effectuée ---' : '--- Écriture réelle en base ---')

  const report: Record<string, unknown>[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const year = years[i]
    const startDate = `${year}-${row.startMonthDay}`
    const endDate = `${year}-${row.endMonthDay}`

    const campaign = await upsertCampaign(supabase, clientId, row, startDate, endDate, dryRun)
    const barbierAudienceId = await upsertAudience(supabase, campaign.id, row.campaignNumber, 'barbier', row.barbier, dryRun)
    const coiffeurAudienceId = await upsertAudience(supabase, campaign.id, row.campaignNumber, 'coiffeur', row.coiffeur, dryRun)
    await upsertVideo(supabase, barbierAudienceId, row.campaignNumber, 'barbier', row.barbier, dryRun)
    await upsertVideo(supabase, coiffeurAudienceId, row.campaignNumber, 'coiffeur', row.coiffeur, dryRun)

    report.push({
      campaignNumber: row.campaignNumber,
      sourceRow: row.sourceRow,
      campaignId: campaign.id,
      created: campaign.created,
      startDate,
      endDate,
      montantCampagne: row.montantCampagne,
      metaPixelLeads: row.barbier.leads + row.coiffeur.leads,
      rdvCalendly: row.rdvCalendly,
    })
  }

  console.log(JSON.stringify(report, null, 2))
  console.log(dryRun ? 'DRY-RUN terminé — aucune écriture effectuée.' : `Import terminé — ${rows.length} campagne(s) traitée(s).`)
}

main().catch((error) => {
  console.error('ERREUR :', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
