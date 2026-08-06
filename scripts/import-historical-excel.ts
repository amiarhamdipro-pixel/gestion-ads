// Import idempotent des données historiques (campagnes 1 à 19) depuis un
// classeur Excel externe — jamais modifié/déplacé/supprimé, lu en lecture
// seule via scripts/parse-xlsx.ps1 (aucune dépendance npm ajoutée : un
// .xlsx est une archive ZIP de XML, extraite via les outils Windows déjà
// disponibles). Voir BRIEF-CLAUDE-CODE.md : "Les campagnes historiques sont
// désormais alimentées par import Excel. Le dernier fichier importé est
// toujours la source de vérité." Le fichier Synthese_KPI_01_19_Detail.xlsx
// remplace le précédent Synthese_KPI_01_12_Detail.xlsx : mêmes 12 premières
// campagnes réimportées avec les nouvelles valeurs (jamais un ancien reste
// silencieusement conservé), 7 nouvelles (13 à 19).
//
// Usage :
//   npx tsx --env-file=.env scripts/import-historical-excel.ts <chemin.xlsx> [--dry-run]
//
// Idempotence — chaque table est retrouvée par une clé métier stable, jamais
// par un upsert sur une clé synthétique qui risquerait de dupliquer une ligne
// déjà créée par une VRAIE synchro Meta antérieure (campagnes 1 à 19 ayant
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
//
// Dates : ce fichier stocke Date debut/Date fin en dates Excel réelles
// (cellules kind='date-serial', année incluse, aucune ambiguïté) — à la
// différence du fichier 1-12 précédent qui les stockait en texte "JJ/MM"
// sans année (nécessitant une inférence chronologique). Les deux formats
// restent supportés (voir resolveDates ci-dessous) pour ne jamais casser un
// éventuel futur fichier revenant à l'ancien format ; un mélange des deux
// dans un même fichier fait échouer l'import (cas non prévu, jamais deviné).

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createAdminClient } from '../lib/supabase/admin'

const CLIENT_SLUG = 'mcc'
// Périmètre strict de cet incrément (voir en-tête BRIEF-CLAUDE-CODE.md) :
// toute ligne hors 1..19 arrête l'import plutôt que de le traiter en
// silence — les campagnes 20+ ne doivent jamais être touchées par ce script.
const MAX_CAMPAIGN_NUMBER = 19

type Supa = ReturnType<typeof createAdminClient>

type CellKind = 'string' | 'number' | 'date-serial' | 'bool' | 'formula-string' | 'error'
type Cell = { col: number; ref: string; kind: CellKind; value: string | number | boolean }
type SheetRow = { row: number; cells: Cell[] }
type SheetData = { sheetName: string; rows: SheetRow[] }

// Les en-têtes ne suivent pas un patron uniforme ("{Mot} {Audience}" pour la
// plupart, mais "Lead {Audience} Homme/Femme X" et "Lecture/Accroche/
// Retention {Audience} ..." avec l'audience au milieu) — recopiées telles
// quelles depuis le fichier réel plutôt que reconstruites par template, pour
// ne jamais introduire une variante plausible mais fausse.
function audienceHeaders(prefix: 'Barber' | 'Coiffeur'): string[] {
  return [
    `Video ${prefix}`, `Leads ${prefix}`, `CPL ${prefix}`, `Depenses ${prefix}`,
    `Lead ${prefix} Homme 18/24`, `Lead ${prefix} Homme 25/34`, `Lead ${prefix} Homme 35/44`, `Lead ${prefix} Homme 45/54`,
    `Lead ${prefix} Femme 18/24`, `Lead ${prefix} Femme 25/34`, `Lead ${prefix} Femme 35/44`, `Lead ${prefix} Femme 45/54`,
    `Facebook ${prefix}`, `Instagram ${prefix}`,
    `Vues ${prefix}`, `Lecture ${prefix} (s)`, `Accroche ${prefix} %`, `Retention ${prefix} %`,
  ]
}

const EXPECTED_HEADERS = [
  'Campagne', 'Date debut', 'Date fin', 'RDV Calendly', 'Montant Campagne',
  ...audienceHeaders('Barber'),
  ...audienceHeaders('Coiffeur'),
]

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
// même valeur réelle, type de cellule Excel différent, aucune invention).
// Cellule absente => null, jamais 0.
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

// ─── Dates ───────────────────────────────────────────────────────────────

// Époque Excel : jour 0 = 1899-12-30 (compatible avec le bug historique du
// 29/02/1900 fictif, présent dans tous les tableurs). 25569 = nombre de
// jours entre cette époque et 1970-01-01 (constante standard de conversion
// série Excel -> Unix). Vérifié sur une valeur déjà connue et indépendamment
// confirmée (campagne n°13, ligne du fichier -> 2026-02-28, identique au
// start_date réel déjà en base, sourcé Meta avant tout import Excel).
function excelSerialToIso(serial: number): string {
  return new Date((serial - 25569) * 86400000).toISOString().slice(0, 10)
}

function parseDdMm(raw: string, cellRef: string): string {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!match) throw new Error(`Cellule ${cellRef} : date "${raw}" ne correspond pas au format attendu JJ/MM.`)
  return `${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

type DateCellValue = { kind: 'iso'; date: string } | { kind: 'partial'; monthDay: string }

function dateCell(row: SheetRow, headerIndex: Map<string, number>, header: string): DateCellValue {
  const cell = cellAt(row, headerIndex.get(header)!)
  if (!cell) throw new Error(`Ligne ${row.row} : colonne "${header}" requise mais absente/vide.`)
  if (cell.kind === 'date-serial') return { kind: 'iso', date: excelSerialToIso(cell.value as number) }
  if (cell.kind === 'string') return { kind: 'partial', monthDay: parseDdMm((cell.value as string).trim(), cell.ref) }
  throw new Error(`Cellule ${cell.ref} (ligne ${row.row}) : date attendue pour "${header}" (date Excel ou texte JJ/MM), trouvé ${cell.kind}.`)
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
  leadsMale1824: number | null
  leadsMale2534: number | null
  leadsMale3544: number | null
  leadsMale4554: number | null
  leadsFemale1824: number | null
  leadsFemale2534: number | null
  leadsFemale3544: number | null
  leadsFemale4554: number | null
}

type ParsedRow = {
  sourceRow: number
  campaignNumber: number
  startDate: DateCellValue
  endDate: DateCellValue
  rdvCalendly: number
  montantCampagne: number
  barbier: AudienceCols
  coiffeur: AudienceCols
}

// Corrections manuelles ponctuelles, validées explicitement par l'utilisateur
// avant tout import — jamais appliquées automatiquement/silencieusement.
// Campagne n°13 (Synthese_KPI_01_19_Detail.xlsx, cellule Y14, "Leads
// Coiffeur") : le fichier contient 30,95 — un nombre de leads fractionnaire,
// impossible en réalité, incohérent avec Facebook Coiffeur + Instagram
// Coiffeur (4+5=9) ET la somme des 8 colonnes âge x genre de la même ligne
// (9), qui concordent parfaitement entre elles (valeur suspecte : très
// proche de CPL Barber sur la même ligne, 30,946... — probable copier-coller
// depuis la mauvaise cellule dans le fichier source). Confirmé par
// l'utilisateur : utiliser 9.
const MANUAL_OVERRIDES: { campaignNumber: number; header: string; correctedValue: number }[] = [
  { campaignNumber: 13, header: 'Leads Coiffeur', correctedValue: 9 },
]

function applyManualOverride(campaignNumber: number, header: string, rawValue: number): number {
  const override = MANUAL_OVERRIDES.find((o) => o.campaignNumber === campaignNumber && o.header === header)
  if (!override) return rawValue
  console.log(`Correction manuelle appliquée : campagne n°${campaignNumber}, "${header}" = ${rawValue} (fichier) -> ${override.correctedValue} (confirmé).`)
  return override.correctedValue
}

// Noms définitifs des vidéos, confirmés explicitement par l'utilisateur —
// remplacent la valeur des colonnes "Video Barber"/"Video Coiffeur" du
// fichier (placeholders génériques "Video N" pour la plupart des campagnes,
// ou noms réels sans extension/normalisation pour d'autres). Casse, espaces
// et extension ".mp4" reproduits exactement tels que confirmés. Jamais
// appliqué silencieusement : toujours journalisé. Redeviendra redondant
// (sans risque, la valeur restera identique) si un futur fichier source
// contient directement ces mêmes noms dans ses colonnes Video Barber/Coiffeur.
const VIDEO_NAME_OVERRIDES: Record<string, string> = {
  '1:barbier': 'video 1 - armand medicament v02.mp4',
  '1:coiffeur': 'mcc pub 1.mp4',
  '2:barbier': 'video 2 - ARMAND TETE TECHNIQUE.mp4',
  '2:coiffeur': 'mcc pub 2.mp4',
  '3:barbier': 'video 3 - video ciseaux.mp4',
  '3:coiffeur': 'mcc pub 3.mp4',
  '4:barbier': 'video 4- taper vcut v.02.mp4',
  '4:coiffeur': 'mcc pub 4.mp4',
  '5:barbier': 'video 5- yonn cut itw.mp4',
  '5:coiffeur': 'mcc pub 5.mp4',
  '6:barbier': 'video 6 - motif design v.02.mp4',
  '6:coiffeur': 'mcc pub 6.mp4',
  '7:barbier': 'video 6 - motif design v.02.mp4',
  '7:coiffeur': 'mcc pub 6.mp4',
  '8:barbier': 'video 7 - coloration fugace - v.02.mp4',
  '8:coiffeur': 'mcc pub 7.mp4',
  '9:barbier': 'video 1 - armand medicament v02.mp4',
  '9:coiffeur': 'mcc pub 1.mp4',
  '10:barbier': 'video 2 - ARMAND TETE TECHNIQUE.mp4',
  '10:coiffeur': 'mcc pub 2.mp4',
  '11:barbier': 'video 3 - video ciseaux.mp4',
  '11:coiffeur': 'mcc pub 3.mp4',
  '12:barbier': 'video 5- yonn cut itw.mp4',
  '12:coiffeur': 'mcc pub 5.mp4',
  '13:barbier': 'video 6 - motif design v.02.mp4',
  '13:coiffeur': 'mcc pub 6.mp4',
  '14:barbier': 'video 7 - coloration fugace - v.02.mp4',
  '14:coiffeur': 'mcc aca pub 1.mp4',
  '15:barbier': 'video 3 - video ciseaux.mp4',
  '15:coiffeur': 'mcc aca pub 2.mp4',
  '16:barbier': 'video 1 - armand medicament v02.mp4',
  '16:coiffeur': 'mcc aca pub 3.mp4',
  '17:barbier': 'video 5- yonn cut itw.mp4',
  '17:coiffeur': 'mcc aca pub 4.mp4',
  '18:barbier': 'video 2 - ARMAND TETE TECHNIQUE.mp4',
  '18:coiffeur': 'mcc aca cpf.mp4',
  '19:barbier': 'video 4- taper vcut v.02.mp4',
  '19:coiffeur': 'mcc aca pub 1.mp4',
}

function applyVideoNameOverride(campaignNumber: number, audienceType: 'barbier' | 'coiffeur', rawName: string | null): string | null {
  const override = VIDEO_NAME_OVERRIDES[`${campaignNumber}:${audienceType}`]
  if (!override) return rawName
  if (rawName !== override) {
    console.log(`Nom vidéo définitif appliqué : campagne n°${campaignNumber} (${audienceType}) : ${JSON.stringify(rawName)} -> ${JSON.stringify(override)}.`)
  }
  return override
}

function parseAudience(
  row: SheetRow,
  headerIndex: Map<string, number>,
  prefix: 'Barber' | 'Coiffeur',
  campaignNumber: number
): AudienceCols {
  const videoHeader = prefix === 'Barber' ? 'Video Barber' : 'Video Coiffeur'
  const audienceType = prefix === 'Barber' ? 'barbier' : 'coiffeur'
  const leadsHeader = `Leads ${prefix}`
  return {
    videoName: applyVideoNameOverride(campaignNumber, audienceType, stringCell(row, headerIndex, videoHeader)),
    leads: applyManualOverride(campaignNumber, leadsHeader, requiredNumberCell(row, headerIndex, leadsHeader)),
    depenses: requiredNumberCell(row, headerIndex, `Depenses ${prefix}`),
    facebook: numberCell(row, headerIndex, `Facebook ${prefix}`),
    instagram: numberCell(row, headerIndex, `Instagram ${prefix}`),
    vues: numberCell(row, headerIndex, `Vues ${prefix}`),
    lectureSeconds: numberCell(row, headerIndex, `Lecture ${prefix} (s)`),
    accrochePct: numberCell(row, headerIndex, `Accroche ${prefix} %`),
    retentionPct: numberCell(row, headerIndex, `Retention ${prefix} %`),
    leadsMale1824: numberCell(row, headerIndex, `Lead ${prefix} Homme 18/24`),
    leadsMale2534: numberCell(row, headerIndex, `Lead ${prefix} Homme 25/34`),
    leadsMale3544: numberCell(row, headerIndex, `Lead ${prefix} Homme 35/44`),
    leadsMale4554: numberCell(row, headerIndex, `Lead ${prefix} Homme 45/54`),
    leadsFemale1824: numberCell(row, headerIndex, `Lead ${prefix} Femme 18/24`),
    leadsFemale2534: numberCell(row, headerIndex, `Lead ${prefix} Femme 25/34`),
    leadsFemale3544: numberCell(row, headerIndex, `Lead ${prefix} Femme 35/44`),
    leadsFemale4554: numberCell(row, headerIndex, `Lead ${prefix} Femme 45/54`),
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
          `Les campagnes 20+ ne doivent jamais être touchées par ce script.`
      )
    }

    parsed.push({
      sourceRow: row.row,
      campaignNumber,
      startDate: dateCell(row, headerIndex, 'Date debut'),
      endDate: dateCell(row, headerIndex, 'Date fin'),
      rdvCalendly: requiredNumberCell(row, headerIndex, 'RDV Calendly'),
      montantCampagne: requiredNumberCell(row, headerIndex, 'Montant Campagne'),
      barbier: parseAudience(row, headerIndex, 'Barber', campaignNumber),
      coiffeur: parseAudience(row, headerIndex, 'Coiffeur', campaignNumber),
    })
  }

  // Doublons de numéro de campagne : jamais silencieusement écrasés l'un par
  // l'autre (le dernier gagnerait sans avertissement) — arrêt explicite.
  const seen = new Map<number, number>()
  for (const row of parsed) {
    if (seen.has(row.campaignNumber)) {
      throw new Error(
        `Campagne n°${row.campaignNumber} présente en double (lignes ${seen.get(row.campaignNumber)} et ${row.sourceRow}). ` +
          `Import arrêté, aucune écriture effectuée.`
      )
    }
    seen.set(row.campaignNumber, row.sourceRow)
  }

  const missing: number[] = []
  for (let n = 1; n <= MAX_CAMPAIGN_NUMBER; n++) if (!seen.has(n)) missing.push(n)
  if (missing.length > 0) {
    throw new Error(
      `Campagne(s) manquante(s) dans le fichier : ${missing.join(', ')} (attendu 1 à ${MAX_CAMPAIGN_NUMBER} exactement). ` +
        `Import arrêté, aucune écriture effectuée.`
    )
  }

  return parsed
}

// ─── Détermination des dates de début/fin ──────────────────────────────
//
// Deux formats possibles selon le fichier (voir DateCellValue) :
// - 'iso' (date Excel réelle, ce fichier) : année déjà incluse, aucune
//   inférence nécessaire — seule une vérification de cohérence chronologique
//   est appliquée (garde-fou générique, pas une détermination).
// - 'partial' (texte "JJ/MM" sans année, ancien fichier 1-12) : l'année est
//   dérivée par continuité chronologique puis ancrée sur la date de début
//   RÉELLE (source Meta, déjà en base) de la toute première campagne qui
//   suit directement la dernière ligne du fichier — jamais devinée sans
//   preuve. Si l'ancre est absente ou la comparaison ambiguë, l'import
//   s'arrête et le signale.
// Un mélange des deux formats dans un même fichier fait échouer l'import
// (cas non prévu, jamais deviné).
function monthOf(monthDay: string): number {
  return Number(monthDay.slice(0, 2))
}

function inferYearsFromPartialDates(
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
  return offsets.map((offset) => lastRowYear - (lastOffset - offset))
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Garde-fou générique appliqué dans les deux formats : la séquence de dates
// de fin doit être non décroissante, et la dernière ligne du fichier ne doit
// jamais se terminer APRÈS le début de la campagne suivante réelle (l'égalité
// stricte le même jour est acceptée : cas réel observé — campagne n°19 se
// termine le jour même où la campagne n°20 réelle commence).
function validateChronology(dates: { startDate: string; endDate: string }[], anchor: { year: number; month: number; day: number }): void {
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].endDate < dates[i - 1].endDate) {
      throw new Error(
        `Ambiguïté réelle : la séquence de dates de fin n'est pas chronologiquement croissante ` +
          `(ligne ${i} : ${dates[i - 1].endDate} -> ${dates[i].endDate}). Import arrêté, aucune écriture effectuée.`
      )
    }
  }
  const anchorDate = `${anchor.year}-${pad2(anchor.month)}-${pad2(anchor.day)}`
  const lastEnd = dates[dates.length - 1].endDate
  if (lastEnd > anchorDate) {
    throw new Error(
      `Incohérence réelle : la dernière ligne du fichier se termine (${lastEnd}) après le début de la campagne ` +
        `suivante réelle (${anchorDate}). Import arrêté, aucune écriture effectuée.`
    )
  }
}

function resolveDates(
  rows: ParsedRow[],
  anchor: { year: number; month: number; day: number }
): { startDate: string; endDate: string }[] {
  const allIso = rows.every((r) => r.startDate.kind === 'iso' && r.endDate.kind === 'iso')
  const allPartial = rows.every((r) => r.startDate.kind === 'partial' && r.endDate.kind === 'partial')

  if (allIso) {
    const dates = rows.map((r) => ({
      startDate: (r.startDate as { kind: 'iso'; date: string }).date,
      endDate: (r.endDate as { kind: 'iso'; date: string }).date,
    }))
    validateChronology(dates, anchor)
    return dates
  }

  if (allPartial) {
    const monthDayRows = rows.map((r) => ({
      startMonthDay: (r.startDate as { kind: 'partial'; monthDay: string }).monthDay,
      endMonthDay: (r.endDate as { kind: 'partial'; monthDay: string }).monthDay,
    }))
    const years = inferYearsFromPartialDates(monthDayRows, anchor)
    const dates = monthDayRows.map((r, i) => ({
      startDate: `${years[i]}-${r.startMonthDay}`,
      endDate: `${years[i]}-${r.endMonthDay}`,
    }))
    validateChronology(dates, anchor)
    return dates
  }

  throw new Error(
    'Dates de formats mélangés dans le fichier (certaines lignes en date Excel, d\'autres en texte JJ/MM) — ' +
      'cas non pris en charge, import arrêté, aucune écriture effectuée.'
  )
}

// ─── Résolution DB ──────────────────────────────────────────────────────

async function resolveClientId(supabase: Supa): Promise<string> {
  const { data, error } = await supabase.from('clients').select('id').eq('slug', CLIENT_SLUG).single()
  if (error || !data) throw new Error(`Client "${CLIENT_SLUG}" introuvable : ${error?.message ?? 'aucune ligne'}`)
  return data.id
}

// Ancre de vérification/détermination des dates : la toute première campagne
// réelle (Meta) qui suit le périmètre de ce fichier (MAX_CAMPAIGN_NUMBER + 1).
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
      `Impossible de vérifier automatiquement les dates : la campagne n°${MAX_CAMPAIGN_NUMBER + 1} ` +
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
      // avant cet import.
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
    leads_male_18_24: cols.leadsMale1824,
    leads_male_25_34: cols.leadsMale2534,
    leads_male_35_44: cols.leadsMale3544,
    leads_male_45_54: cols.leadsMale4554,
    leads_female_18_24: cols.leadsFemale1824,
    leads_female_25_34: cols.leadsFemale2534,
    leads_female_35_44: cols.leadsFemale3544,
    leads_female_45_54: cols.leadsFemale4554,
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
          // Nom exact du fichier vidéo (extension comprise si présente dans
          // le fichier) — remplace systématiquement l'ancienne valeur.
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
  console.log(`${rows.length} ligne(s) de campagne trouvée(s) (feuille "${sheet.sheetName}"), campagnes 1 à ${MAX_CAMPAIGN_NUMBER} — complet, sans doublon (vérifié).`)

  const supabase = createAdminClient()
  const clientId = await resolveClientId(supabase)
  const anchor = await resolveAnchor(supabase, clientId)
  console.log(`Ancre de vérification des dates : campagne n°${MAX_CAMPAIGN_NUMBER + 1}, début ${anchor.year}-${pad2(anchor.month)}-${pad2(anchor.day)}.`)

  const dates = resolveDates(rows, anchor)

  console.log(dryRun ? '--- MODE DRY-RUN : aucune écriture ne sera effectuée ---' : '--- Écriture réelle en base ---')

  const report: Record<string, unknown>[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const { startDate, endDate } = dates[i]

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
