# Lecture seule d'un classeur .xlsx (jamais modifié/déplacé/supprimé) sans
# dépendance npm ajoutée au projet : un .xlsx est une archive ZIP de fichiers
# XML (OOXML) — ce script la copie (jamais le fichier original), l'extrait,
# et convertit sa première feuille en JSON structuré (une cellule = {col,
# ref, kind, value}) consommé par scripts/import-historical-excel.ts.
# Utilisé pour l'import historique (voir BRIEF-CLAUDE-CODE.md) : lit
# uniquement la PREMIÈRE feuille du classeur (suffisant pour un export KPI
# mono-feuille ; à étendre si un futur fichier source en contient plusieurs).
#
# -Encoding UTF8 explicite sur chaque Get-Content : les XML OOXML sont en
# UTF-8 sans BOM ; Windows PowerShell 5.1 les lit sinon avec l'encodage ANSI
# de la session, corrompant tout caractère accentué (ex. "vidéo" -> "vidÃ©o")
# — bug réel détecté sur un nom de vidéo importé (Synthese_KPI_01_19), corrigé
# ici pour toute chaîne lue par ce script (noms de vidéo, en-têtes...).
param(
  [Parameter(Mandatory = $true)][string]$XlsxPath,
  [Parameter(Mandatory = $true)][string]$OutJson
)

if (-not (Test-Path $XlsxPath)) {
  throw "Fichier introuvable : $XlsxPath"
}

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("xlsx-read-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
try {
  $zipCopy = Join-Path $workDir 'workbook.zip'
  Copy-Item -Path $XlsxPath -Destination $zipCopy -Force
  $extractDir = Join-Path $workDir 'extracted'
  Expand-Archive -Path $zipCopy -DestinationPath $extractDir -Force

  [xml]$wb = Get-Content -Raw -Encoding UTF8 (Join-Path $extractDir 'xl\workbook.xml')
  $sheetName = $wb.workbook.sheets.sheet[0].name
  if (-not $sheetName) { $sheetName = $wb.workbook.sheets.sheet.name }

  $sstPath = Join-Path $extractDir 'xl\sharedStrings.xml'
  $sharedStrings = @()
  if (Test-Path $sstPath) {
    [xml]$sst = Get-Content -Raw -Encoding UTF8 $sstPath
    if ($sst.sst.si) {
      foreach ($si in $sst.sst.si) { $sharedStrings += $si.InnerText }
    }
  }

  [xml]$styles = Get-Content -Raw -Encoding UTF8 (Join-Path $extractDir 'xl\styles.xml')
  $customNumFmts = @{}
  if ($styles.styleSheet.numFmts) {
    foreach ($nf in $styles.styleSheet.numFmts.numFmt) { $customNumFmts[[int]$nf.numFmtId] = $nf.formatCode }
  }
  $cellXfs = @()
  foreach ($xf in $styles.styleSheet.cellXfs.xf) { $cellXfs += [int]$xf.numFmtId }
  $builtinDateFmtIds = @(14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47)

  function Is-DateStyle([int]$styleIndex) {
    if ($styleIndex -lt 0 -or $styleIndex -ge $cellXfs.Count) { return $false }
    $numFmtId = $cellXfs[$styleIndex]
    if ($builtinDateFmtIds -contains $numFmtId) { return $true }
    if ($customNumFmts.ContainsKey($numFmtId)) {
      $code = $customNumFmts[$numFmtId]
      if ($code -match '[ymdhs]' -and $code -notmatch '^"') { return $true }
    }
    return $false
  }

  function Col-Index([string]$letters) {
    $idx = 0
    foreach ($ch in $letters.ToCharArray()) { $idx = $idx * 26 + ([int][char]$ch - [int][char]'A' + 1) }
    return $idx - 1
  }

  [xml]$sheet = Get-Content -Raw -Encoding UTF8 (Join-Path $extractDir 'xl\worksheets\sheet1.xml')
  $rows = @()
  foreach ($row in $sheet.worksheet.sheetData.row) {
    $rowNum = [int]$row.r
    $cells = @()
    if ($row.c) {
      foreach ($c in $row.c) {
        $ref = $c.r
        $colLetters = ($ref -replace '[0-9]', '')
        $colIdx = Col-Index $colLetters
        $type = $c.t
        $styleIdx = if ($c.s) { [int]$c.s } else { 0 }
        $rawV = $c.v
        $value = $null
        $kind = 'empty'

        if ($type -eq 's') {
          if ($null -ne $rawV) { $value = $sharedStrings[[int]$rawV]; $kind = 'string' }
        } elseif ($type -eq 'inlineStr') {
          if ($c.is) { $value = $c.is.InnerText; $kind = 'string' }
        } elseif ($type -eq 'str') {
          if ($null -ne $rawV) { $value = $rawV; $kind = 'formula-string' }
        } elseif ($type -eq 'b') {
          if ($null -ne $rawV) { $value = ($rawV -eq '1'); $kind = 'bool' }
        } elseif ($type -eq 'e') {
          if ($null -ne $rawV) { $value = $rawV; $kind = 'error' }
        } else {
          if ($null -ne $rawV) {
            $value = [double]$rawV
            $kind = if (Is-DateStyle $styleIdx) { 'date-serial' } else { 'number' }
          }
        }

        if ($kind -ne 'empty') { $cells += @{ col = $colIdx; ref = $ref; kind = $kind; value = $value } }
      }
    }
    $rows += @{ row = $rowNum; cells = $cells }
  }

  $result = @{ sheetName = $sheetName; rows = $rows }
  $result | ConvertTo-Json -Depth 10 -Compress | Out-File -FilePath $OutJson -Encoding utf8
} finally {
  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}
