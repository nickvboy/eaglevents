<#
  drop-local-database.ps1

  Drops local PostgreSQL databases defined in your .env file.
  It mirrors the env-driven behavior of create-local-database.ps1.

  Reads connection details from:
    - .env (DATABASE_URL, DATABASE_URL_PROD)
    - POSTGRES_URL as an alternative for the dev URL, if set

  Behavior:
    - For each URL found, connects to the server's maintenance DB (postgres)
      using host/port/user from the URL, checks if the target DB exists, and
      drops it if present.
    - Uses DROP DATABASE ... WITH (FORCE) when available; otherwise falls back
      to terminating connections then dropping.

  Examples:
    - .\drop-local-database.ps1 -Diag                 # Drop both dev and prod if they exist
    - .\drop-local-database.ps1 -Target dev -Diag     # Drop only dev DB
    - .\drop-local-database.ps1 -Target prod          # Drop only prod DB
    - .\drop-local-database.ps1 -NoForce              # Avoid USING WITH (FORCE); use fallback

#>

param(
  [switch]$Diag,
  [ValidateSet('dev','prod','both')]
  [string]$Target = 'both',
  # If set, disables DROP DATABASE ... WITH (FORCE) and uses a compatibility
  # fallback (terminate backends + DROP DATABASE).
  [switch]$NoForce
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }
function Write-Diag($msg) { if ($Diag) { Write-Host "[debug] $msg" -ForegroundColor Yellow } }

function Load-DotEnv([string]$Path = ".env") {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith('#')) { return }
    if ($line -like 'export *') { $line = $line.Substring(7).Trim() }
    $m = [regex]::Match($line, '^(?<k>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<v>.*)$')
    if (-not $m.Success) { return }
    $k = $m.Groups['k'].Value
    $v = $m.Groups['v'].Value.Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length-2) }
    elseif ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length-2) }
    Set-Item -Path "Env:$k" -Value $v
  }
}

function Parse-DbUrl([string]$Url) {
  if (-not $Url) { return $null }
  $out = @{ User = $null; Password = $null; Host = $null; Port = 5432; Database = $null }
  try {
    Write-Diag "parser: raw => $Url"
    $sep = $Url.IndexOf('://')
    if ($sep -ge 0) { $str = $Url.Substring($sep + 3) } else { $str = $Url }
    Write-Diag "parser: stripped scheme => $str"

    $ats = $str -split '@', 2
    $creds = $null
    $rest = $str
    if ($ats.Count -eq 2) { $creds = $ats[0]; $rest = $ats[1] }
    Write-Diag "parser: creds='$creds' rest='$rest'"

    if ($creds) {
      $cp = $creds -split ':', 2
      $out.User = $cp[0]
      if ($cp.Count -gt 1) { $out.Password = $cp[1] }
    }
    $slash = $rest -split '/', 2
    $hostport = $slash[0]
    if ($slash.Count -gt 1) {
      $out.Database = $slash[1]
      if ($out.Database -and $out.Database.Contains('?')) {
        $out.Database = $out.Database.Split('?',2)[0]
      }
    }
    if ($hostport) {
      $hp = $hostport -split ':', 2
      $out.Host = $hp[0]
      if ($hp.Count -gt 1 -and $hp[1]) { $out.Port = [int]$hp[1] }
    }
  } catch { }
  return $out
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' not found on PATH. Please install it."
  }
}

function Test-PsqlConnection(
  [string]$ServerHost,
  [int]$ServerPort,
  [string]$UserName,
  [string]$DbName
) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $null = & psql -h $ServerHost -p "$ServerPort" -U $UserName -d $DbName -tAc 'SELECT 1' 2>$null
  $code = $LASTEXITCODE; $ErrorActionPreference = $old
  return ($code -eq 0)
}

function Drop-Database(
  [string]$Label,
  [string]$ServerHost,
  [int]$ServerPort,
  [string]$UserName,
  [string]$PasswordText,
  [string]$DbName
) {
  if (-not $DbName) { Write-Err "[$Label] Missing database name"; return $false }

  if ($PasswordText) { $env:PGPASSWORD = $PasswordText } else { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  $maintDb = 'postgres'

  if (-not (Test-PsqlConnection -ServerHost $ServerHost -ServerPort $ServerPort -UserName $UserName -DbName $maintDb)) {
    Write-Err "[$Label] Cannot connect to server at ${ServerHost}:${ServerPort} as ${UserName}."
    return $false
  }

  $dbNameSql = $DbName.Replace("'", "''")
  $existsOut = & psql -h $ServerHost -p "$ServerPort" -U $UserName -d $maintDb -tAc "SELECT 1 FROM pg_database WHERE datname='$dbNameSql'" 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Err "[$Label] Failed to query pg_database"; return $false }
  $exists = ($existsOut | Out-String).Trim() -eq '1'
  if (-not $exists) { Write-Info "[$Label] Database '$DbName' does not exist - skipping."; return $true }

  Write-Info "[$Label] Dropping database '$DbName' on ${ServerHost}:${ServerPort} ..."
  $dbIdent = $DbName.Replace('"','""')

  $sqlForce = ('DROP DATABASE IF EXISTS "{0}" WITH (FORCE);' -f $dbIdent)
  $tmpForce = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmpForce, $sqlForce)
  & psql -h $ServerHost -p "$ServerPort" -U $UserName -d $maintDb -v ON_ERROR_STOP=1 -f $tmpForce | Out-Null
  $forceCode = $LASTEXITCODE
  Remove-Item -LiteralPath $tmpForce -Force -ErrorAction SilentlyContinue
  if ($forceCode -eq 0 -and -not $NoForce) {
    Write-Info "[$Label] Dropped database '$DbName' using WITH (FORCE)."
    return $true
  }

  # Fallback path (or if -NoForce): revoke + terminate + drop
  $sql = @"
REVOKE CONNECT ON DATABASE "$dbIdent" FROM PUBLIC;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$dbNameSql';
DROP DATABASE IF EXISTS "$dbIdent";
"@
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $sql)
  & psql -h $ServerHost -p "$ServerPort" -U $UserName -d $maintDb -v ON_ERROR_STOP=1 -f $tmp | Out-Null
  $code = $LASTEXITCODE
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  if ($code -ne 0) { Write-Err "[$Label] Failed to drop database '$DbName'."; return $false }
  Write-Info "[$Label] Dropped database '$DbName'."
  return $true
}

# ---- Main ----
Load-DotEnv
Require-Command psql

Write-Diag "env:DATABASE_URL=$($env:DATABASE_URL)"
Write-Diag "env:DATABASE_URL_PROD=$($env:DATABASE_URL_PROD)"
Write-Diag "env:POSTGRES_URL=$($env:POSTGRES_URL)"

$devUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } elseif ($env:POSTGRES_URL) { $env:POSTGRES_URL } else { $null }
$prodUrl = $env:DATABASE_URL_PROD

$ok = $true

if ($Target -in @('dev','both')) {
  if ($devUrl) {
    $dev = Parse-DbUrl $devUrl
    if ($dev) {
      Write-Info "[dev] Using connection: host=$($dev.Host) port=$($dev.Port) user=$($dev.User) db=$($dev.Database)"
      if (-not (Drop-Database -Label 'dev' -ServerHost $dev.Host -ServerPort $dev.Port -UserName $dev.User -PasswordText $dev.Password -DbName $dev.Database)) { $ok = $false }
    } else { Write-Err "[dev] Failed to parse DATABASE_URL"; $ok = $false }
  } else { Write-Diag "[dev] No DATABASE_URL/POSTGRES_URL provided; skipping." }
}

if ($Target -in @('prod','both')) {
  if ($prodUrl) {
    $prod = Parse-DbUrl $prodUrl
    if ($prod) {
      Write-Info "[prod] Using connection: host=$($prod.Host) port=$($prod.Port) user=$($prod.User) db=$($prod.Database)"
      if (-not (Drop-Database -Label 'prod' -ServerHost $prod.Host -ServerPort $prod.Port -UserName $prod.User -PasswordText $prod.Password -DbName $prod.Database)) { $ok = $false }
    } else { Write-Err "[prod] Failed to parse DATABASE_URL_PROD"; $ok = $false }
  } else { Write-Diag "[prod] No DATABASE_URL_PROD provided; skipping." }
}

if ($ok) { exit 0 } else { exit 1 }
