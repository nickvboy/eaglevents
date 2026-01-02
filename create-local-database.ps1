<#
  create-local-database.ps1

  Creates a local PostgreSQL database if it does not already exist.
  Reads connection details from:
    - .env (KEY=VALUE lines; exported to $env:*)
    - DATABASE_URL / POSTGRES_URL (postgres://user:pass@host:port/dbname)
    - PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)

  Assumptions (updated):
    - psql is installed and on PATH.
    - If no Postgres is listening on the requested localhost port, this script
      can optionally start a local container (Docker/Podman) bound to that port
      and initialize the requested database.
#>

param(
  [switch]$Diag,
  [ValidateSet('dev','prod','both')]
  [string]$Target = 'both',
  # If set, will try to start a local Postgres container on the requested port when nothing is listening there.
  # Disabled by default since your setup may not use Docker/Podman.
  [switch]$UseContainers,
  # Fallback local port to probe if the requested port is not listening.
  [int]$FallbackPort = 5432,
  # If falling back to another local port succeeds, optionally rewrite the .env URLs to use that port.
  [switch]$RewriteEnv
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }
function Write-Diag($msg) { if ($Diag) { Write-Host "[debug] $msg" -ForegroundColor Yellow } }

# Quietly test if we can connect to Postgres and run SELECT 1.
function Test-PsqlConnection(
  [string]$ServerHost,
  [int]$ServerPort,
  [string]$UserName,
  [string]$DbName
) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $null = & psql -h $ServerHost -p "$ServerPort" -U $UserName -d $DbName -tAc 'SELECT 1' 2>$null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  return ($code -eq 0)
}

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
    # Strip scheme using index (robust on PS5)
    $sep = $Url.IndexOf('://')
    if ($sep -ge 0) { $str = $Url.Substring($sep + 3) } else { $str = $Url }
    Write-Diag "parser: stripped scheme => $str"

    # Split credentials and host/path
    $ats = $str -split '@', 2
    $creds = $null
    $rest = $str
    if ($ats.Count -eq 2) {
      $creds = $ats[0]
      $rest = $ats[1]
    }
    Write-Diag "parser: creds='$creds' rest='$rest'"

    if ($creds) {
      $cp = $creds -split ':', 2
      $out.User = $cp[0]
      if ($cp.Count -gt 1) { $out.Password = $cp[1] }
    }

    # Split host[:port]/db
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
  } catch {
    # leave defaults
  }
  return $out
}

function Ensure-DbFromUrl(
  [string]$Label,
  [string]$Url,
  [string]$DefaultHost,
  [int]$DefaultPort,
  [string]$DefaultUser,
  [string]$DefaultPass,
  [string]$DefaultName
) {
  $dbHost = $DefaultHost
  $dbPort = $DefaultPort
  $dbUser = $DefaultUser
  $dbPass = $DefaultPass
  $dbName = $DefaultName

  if ($Url) {
    $parsed = Parse-DbUrl $Url
    if ($parsed) {
      Write-Diag "[$Label] parsed => Host=$($parsed.Host) Port=$($parsed.Port) User=$($parsed.User) Database=$($parsed.Database) PasswordSet=$([bool]$parsed.Password)"
      if ($parsed.Host) { $dbHost = $parsed.Host }
      if ($parsed.Port) { $dbPort = [int]$parsed.Port }
      if ($parsed.User) { $dbUser = $parsed.User }
      if ($parsed.Password) { $dbPass = $parsed.Password }
      if ($parsed.Database) { $dbName = $parsed.Database }
    }
  }

  Write-Diag "[$Label] resolved => Host=$dbHost Port=$dbPort User=$dbUser Database=$dbName PasswordSet=$([bool]$dbPass)"
  if (-not $dbName) {
    Write-Err "[$Label] Could not determine database name. Set PGDATABASE or the corresponding URL in .env."
    return $false
  }

  if ($dbPass) { $env:PGPASSWORD = $dbPass } else { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  $maintDb = if ($env:PGMAINT_DB) { $env:PGMAINT_DB } else { 'postgres' }

  Write-Info "[$Label] Using connection: host=$dbHost port=$dbPort user=$dbUser db=$dbName"

  # Test connectivity (check exit code)
  $canConnect = Test-PsqlConnection -ServerHost $dbHost -ServerPort $dbPort -UserName $dbUser -DbName $maintDb
  if (-not $canConnect) {
    Write-Err "[$Label] Cannot connect to server at ${dbHost}:${dbPort} as ${dbUser}."
    if ($dbHost -in @('localhost','127.0.0.1')) {
      # Optionally try containers if requested
      if ($UseContainers) {
        if (Start-LocalPostgres -Label $Label -Host $dbHost -Port $dbPort -User $dbUser -Password $dbPass -DbName $dbName) {
          Write-Info "[$Label] Retesting connectivity on ${dbHost}:${dbPort}..."
          Start-Sleep -Seconds 1
          if (-not (Test-PsqlConnection -ServerHost $dbHost -ServerPort $dbPort -UserName $dbUser -DbName $maintDb)) {
            Write-Err "[$Label] Still cannot connect to ${dbHost}:${dbPort} after starting container."
            return $false
          }
        } else {
          return $false
        }
      } else {
        # Probe fallback local port (default 5432) where a Windows service often runs
        if ($dbPort -ne $FallbackPort) {
          Write-Diag "[$Label] Probing fallback local port $FallbackPort..."
          if (Test-PsqlConnection -ServerHost $dbHost -ServerPort $FallbackPort -UserName $dbUser -DbName $maintDb) {
            Write-Info "[$Label] Found local Postgres on ${dbHost}:${FallbackPort}."
            # Create DB on fallback port
            $dbNameSql2 = $dbName.Replace("'", "''")
            $createOut = & psql -h $dbHost -p "$FallbackPort" -U $dbUser -d $maintDb -tAc "SELECT 1 FROM pg_database WHERE datname='$dbNameSql2'" 2>$null
            $exists2 = ($createOut | Out-String).Trim() -eq '1'
            if (-not $exists2) {
              Write-Info "[$Label] Creating database '$dbName' on ${dbHost}:${FallbackPort} ..."
              $dbIdent2 = $dbName.Replace('"','""')
              $userIdent2 = $dbUser.Replace('"','""')
              $sql2 = @"
CREATE DATABASE "$dbIdent2" OWNER "$userIdent2";
"@
              $tmp2 = [System.IO.Path]::GetTempFileName()
              [System.IO.File]::WriteAllText($tmp2, $sql2)
              & psql -h $dbHost -p "$FallbackPort" -U $dbUser -d $maintDb -v ON_ERROR_STOP=1 -f $tmp2 | Out-Null
              $code2 = $LASTEXITCODE
              Remove-Item -LiteralPath $tmp2 -Force -ErrorAction SilentlyContinue
              if ($code2 -ne 0) { Write-Err "[$Label] Failed to create DB on fallback port $FallbackPort."; return $false }
              Write-Info "[$Label] Database '$dbName' created on ${dbHost}:${FallbackPort}."
            } else {
              Write-Info "[$Label] Database '$dbName' already exists on ${dbHost}:${FallbackPort}."
            }

            if ($RewriteEnv) {
              try {
                $key = "DATABASE_URL"
                if ($Label -eq 'prod') { $key = 'DATABASE_URL_PROD' }
                Update-EnvUrlPort -Key $key -NewPort $FallbackPort
                Write-Info "[$Label] Updated .env to use port $FallbackPort for the URL."
              } catch { Write-Err "[$Label] Failed to rewrite .env: $_" }
            } else {
              Write-Info "[$Label] NOTE: Your URL still points to port $dbPort. Update .env to $FallbackPort or rerun with -RewriteEnv to auto-update."
            }

            return $true
          }
        }
        Write-Err "[$Label] No Postgres detected on ${dbHost}:${dbPort} and container startup disabled."
        return $false
      }
    } else {
      Write-Err "[$Label] Non-local host '${dbHost}' is unreachable."
      return $false
    }
  }

  # Check if DB exists
  $dbNameSql = $dbName.Replace("'", "''")
  $existsOut = & psql -h $dbHost -p "$dbPort" -U $dbUser -d $maintDb -tAc "SELECT 1 FROM pg_database WHERE datname='$dbNameSql'" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Err "[$Label] Failed to query pg_database. Check connectivity/permissions."
    return $false
  }
  $exists = ($existsOut | Out-String).Trim()
  if ($exists -eq '1') {
    Write-Info "[$Label] Database '$dbName' already exists."
    return $true
  }

  Write-Info "[$Label] Creating database '$dbName'..."
  $dbIdent = $dbName.Replace('"','""')
  $userIdent = $dbUser.Replace('"','""')
  $createSql = @"
CREATE DATABASE "$dbIdent" OWNER "$userIdent";
"@

  # Use temp file to avoid any argument quoting issues
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $createSql)
  & psql -h $dbHost -p "$dbPort" -U $dbUser -d $maintDb -v ON_ERROR_STOP=1 -f $tmp | Out-Null
  $code = $LASTEXITCODE
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  if ($code -ne 0) {
    Write-Err "[$Label] Failed to create database '$dbName'."
    return $false
  }

  Write-Info "[$Label] Database '$dbName' created."
  return $true
}

# Attempts to start a local Postgres (Docker/Podman) binding the given port and
# initializing the database name. Returns $true on success, $false otherwise.
function Start-LocalPostgres(
  [string]$Label,
  [string]$Host,
  [int]$Port,
  [string]$User,
  [string]$Password,
  [string]$DbName
) {
  try {
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    $podmanCmd = Get-Command podman -ErrorAction SilentlyContinue
    if (-not $dockerCmd -and -not $podmanCmd) {
      Write-Err "[$Label] No Docker/Podman found; cannot auto-start Postgres on port $Port."
      return $false
    }
    $cmd = if ($dockerCmd) { 'docker' } else { 'podman' }
    # Check engine is running
    $null = & $cmd info 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Err "[$Label] $cmd daemon is not running. Please start it and re-run."
      return $false
    }

    # If port already in use by something else, do not proceed
    $portBusy = $false
    try {
      $tnc = Test-NetConnection -ComputerName 'localhost' -Port $Port -WarningAction SilentlyContinue
      if ($tnc -and $tnc.TcpTestSucceeded) { $portBusy = $true }
    } catch { }
    if ($portBusy) {
      Write-Err "[$Label] Port $Port is already in use by another process."
      return $false
    }

    # Sanitize container name
    $safeName = ($DbName -replace '[^a-zA-Z0-9_.-]', '-')
    $container = "$safeName-$Port-postgres"

    # If container exists, start it; else create new
    $exists = (& $cmd ps -a -q -f "name=$container").Trim()
    if ($LASTEXITCODE -eq 0 -and $exists) {
      Write-Info "[$Label] Starting existing container '$container' on port $Port..."
      $null = & $cmd start $container
      if ($LASTEXITCODE -ne 0) { Write-Err "[$Label] Failed to start container '$container'."; return $false }
    } else {
      Write-Info "[$Label] Creating local Postgres container '$container' on port $Port..."
      $args = @(
        'run','-d',
        '--name', $container,
        '-e', "POSTGRES_USER=$User",
        '-e', "POSTGRES_PASSWORD=$Password",
        '-e', "POSTGRES_DB=$DbName",
        '-p', "$Port:5432",
        'postgres:16'
      )
      $null = & $cmd @args
      if ($LASTEXITCODE -ne 0) {
        Write-Err "[$Label] Failed to create Postgres container via $cmd."
        return $false
      }
    }

    # Wait for server to accept connections
    Write-Info "[$Label] Waiting for Postgres to become ready on ${Host}:${Port} ..."
    $ready = $false
    for ($i=0; $i -lt 30; $i++) {
      if (Test-PsqlConnection -ServerHost $Host -ServerPort $Port -UserName $User -DbName 'postgres') { $ready = $true; break }
      Start-Sleep -Seconds 1
    }
    if (-not $ready) {
      Write-Err "[$Label] Postgres container did not become ready in time."
      return $false
    }
    Write-Info "[$Label] Postgres is ready on ${Host}:${Port}."
    return $true
  } catch {
    Write-Err "[$Label] Unexpected error while starting local Postgres: $_"
    return $false
  }
}

# Update the port in a KEY=postgresql://... URL entry inside .env
function Update-EnvUrlPort(
  [Parameter(Mandatory=$true)][string]$Key,
  [Parameter(Mandatory=$true)][int]$NewPort,
  [string]$Path = ".env"
) {
  if (-not (Test-Path -LiteralPath $Path)) { throw ".env not found" }
  $lines = Get-Content -LiteralPath $Path
  $changed = $false
  for ($i=0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=") {
      $m = [regex]::Match($line, '^(\s*'+[regex]::Escape($Key)+'\s*=\s*)(.+)$')
      if ($m.Success) {
        $prefix = $m.Groups[1].Value
        $url = $m.Groups[2].Value.Trim()
        if (($url.StartsWith('"') -and $url.EndsWith('"')) -or ($url.StartsWith("'") -and $url.EndsWith("'"))) {
          $quote = $url.Substring(0,1)
          $raw = $url.Substring(1, $url.Length-2)
        } else { $quote = ''; $raw = $url }
        try {
          $idx = $raw.IndexOf('://')
          $rest = if ($idx -ge 0) { $raw.Substring($idx+3) } else { $raw }
          $ats = $rest.Split('@',2)
          $rest2 = if ($ats.Count -eq 2) { $ats[1] } else { $rest }
          $slash = $rest2.Split('/',2)
          $hostport = $slash[0]
          $after = if ($slash.Count -gt 1) { '/'+$slash[1] } else { '' }
          $hp = $hostport.Split(':',2)
          $host = $hp[0]
          $newRaw = $raw.Replace($hostport, "${host}:${NewPort}")
          $newVal = if ($quote) { $quote + $newRaw + $quote } else { $newRaw }
          $lines[$i] = $prefix + $newVal
          $changed = $true
        } catch {
          throw "Failed to parse URL for $Key"
        }
      }
    }
  }
  if ($changed) { Set-Content -LiteralPath $Path -Value $lines -NoNewline }
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' not found on PATH. Please install it."
  }
}

# Load env from .env (if present)
Load-DotEnv

Require-Command psql

# Establish defaults from PG* env vars (if present)
$defHost = if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }
$defPort = if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }
$defUser = if ($env:PGUSER) { $env:PGUSER } else { 'postgres' }
$defPass = $env:PGPASSWORD
$defName = $env:PGDATABASE

Write-Diag "env:DATABASE_URL=$($env:DATABASE_URL)"
Write-Diag "env:DATABASE_URL_PROD=$($env:DATABASE_URL_PROD)"
Write-Diag "env:POSTGRES_URL=$($env:POSTGRES_URL)"
Write-Diag "env:PGHOST=$($env:PGHOST) PGPORT=$($env:PGPORT) PGUSER=$($env:PGUSER) PGDATABASE=$($env:PGDATABASE)"
Write-Diag "env:PGPASSWORD set=$([bool]$env:PGPASSWORD)"

$devUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } elseif ($env:POSTGRES_URL) { $env:POSTGRES_URL } else { $null }
$prodUrl = $env:DATABASE_URL_PROD

$ok = $true
if ($Target -in @('dev','both')) {
  if ($devUrl -or $defName) {
    if (-not (Ensure-DbFromUrl -Label 'dev' -Url $devUrl -DefaultHost $defHost -DefaultPort $defPort -DefaultUser $defUser -DefaultPass $defPass -DefaultName $defName)) { $ok = $false }
  } else {
    Write-Info "[dev] No DATABASE_URL and no PGDATABASE provided; skipping dev database."
  }
}

if ($Target -in @('prod','both')) {
  if ($prodUrl) {
    if (-not (Ensure-DbFromUrl -Label 'prod' -Url $prodUrl -DefaultHost $defHost -DefaultPort $defPort -DefaultUser $defUser -DefaultPass $defPass -DefaultName $null)) { $ok = $false }
  } else {
    Write-Diag "[prod] No DATABASE_URL_PROD provided; skipping prod database."
  }
}

if ($ok) { exit 0 } else { exit 1 }
