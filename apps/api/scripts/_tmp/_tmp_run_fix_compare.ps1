$ErrorActionPreference='Stop'

function Stop-ApiPort {
  $conn = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
}

function Start-Api([string]$binPath, [string]$tag) {
  $out = "D:\project\oneceo.ai\oneceo\apps\api\_tmp_${tag}.out"
  $err = "D:\project\oneceo.ai\oneceo\apps\api\_tmp_${tag}.err"
  if (Test-Path $out) { Remove-Item $out -Force }
  if (Test-Path $err) { Remove-Item $err -Force }
  $cmd = "set OSAC_BINARY_PATH=$binPath&& set OSAC_LLM_PROXY_DEBUG=true&& set LLM_PROXY_DEBUG=true&& pnpm exec tsx src/index.ts"
  $p = Start-Process -FilePath cmd.exe -ArgumentList '/c', $cmd -WorkingDirectory 'D:\project\oneceo.ai\oneceo\apps\api' -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  return @{ pid=$p.Id; out=$out; err=$err }
}

function Wait-Health {
  for ($i=0; $i -lt 20; $i++) {
    curl.exe --noproxy "*" -sS --max-time 2 http://127.0.0.1:4000/health > $null
    if ($LASTEXITCODE -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Run-Case([string]$binPath, [string]$tag) {
  Stop-ApiPort
  $proc = Start-Api -binPath $binPath -tag $tag
  if (-not (Wait-Health)) {
    throw "API health not ready"
  }

  $body='{"metadata":{"owner":"codex-test","purpose":"binary-api-e2e-' + $tag + '"}}'
  $resp = curl.exe --noproxy "*" -sS --max-time 180 -X POST "http://127.0.0.1:4000/api/sandbox/osac/provision" -H "Content-Type: application/json" --data "$body"
  $obj = $resp | ConvertFrom-Json
  $sid = $obj.data.sessionId
  if (-not $sid) {
    throw "provision failed for ${tag}: $resp"
  }

  $probe = pnpm exec tsx scripts/_tmp_probe_session_models.ts 2>&1

  $outTail = ''
  if (Test-Path $proc.out) { $outTail = (Get-Content $proc.out -Tail 120) -join "`n" }
  $errTail = ''
  if (Test-Path $proc.err) { $errTail = (Get-Content $proc.err -Tail 120) -join "`n" }

  Stop-ApiPort

  [PSCustomObject]@{
    tag = $tag
    binary = $binPath
    sessionId = $sid
    probe = $probe
    apiOutTail = $outTail
    apiErrTail = $errTail
  }
}

Set-Location 'D:\project\oneceo.ai\oneceo\apps\api'

$results = @()
$results += Run-Case '../../others/osac-linux/osac-linux-amd64_v1.1.2.fix2' 'fix2'
$results += Run-Case '../../others/osac-linux/osac-linux-amd64_v1.1.2.fix1' 'fix1'

$results | ConvertTo-Json -Depth 5
