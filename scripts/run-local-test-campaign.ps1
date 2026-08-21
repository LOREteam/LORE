param(
  [ValidateRange(1, 24)]
  [int]$Hours = 12,
  [ValidateRange(15, 180)]
  [int]$IntervalMinutes = 45,
  [ValidateRange(0, 100)]
  [int]$MaxIterations = 0,
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
  [string]$CampaignId = ('local-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
)

$ErrorActionPreference = 'Continue'
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $repoRoot '.tmp-npm-runtime-115\node.exe'
$campaignDirectory = Join-Path (Join-Path $repoRoot 'artifacts\test-campaign-2026-08-20') $CampaignId
$summaryPath = Join-Path $campaignDirectory 'local-test-campaign.jsonl'

if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) {
  throw "Private Node runtime is unavailable: $runtime"
}
New-Item -ItemType Directory -Force -Path $campaignDirectory | Out-Null

function Write-CampaignEvent([hashtable]$Event) {
  $record = [ordered]@{
    timestamp = [DateTime]::UtcNow.ToString('o')
  }
  foreach ($key in $Event.Keys) {
    $record[$key] = $Event[$key]
  }
  ($record | ConvertTo-Json -Compress) | Add-Content -LiteralPath $summaryPath -Encoding utf8
}

$commands = @(
  @{ name = 'business-logic-isolated'; arguments = @('scripts\business-logic-isolated-runner.mjs') },
  @{ name = 'p1-hardening-evm'; arguments = @('scripts\run-p1-hardening-tests.mjs', '--include-evm') },
  @{ name = 'contract-v9'; arguments = @('scripts\test-contract-v9-invariants.mjs') },
  @{ name = 'contract-v10'; arguments = @('scripts\test-contract-v10-invariants.mjs') },
  @{ name = 'global-stats-materialization'; arguments = @('.\node_modules\tsx\dist\cli.mjs', 'scripts\test-global-stats-materialization.ts') },
  @{ name = 'leaderboard-materialization'; arguments = @('.\node_modules\tsx\dist\cli.mjs', 'scripts\test-leaderboard-materialization.ts') },
  @{ name = 'hermetic-build'; arguments = @('scripts\test-hermetic-build.mjs') }
)

$deadline = [DateTime]::UtcNow.AddHours($Hours)
$iteration = 0
Write-CampaignEvent @{ status = 'started'; campaignId = $CampaignId; hours = $Hours; intervalMinutes = $IntervalMinutes; deadlineUtc = $deadline.ToString('o') }

while ([DateTime]::UtcNow -lt $deadline -and ($MaxIterations -eq 0 -or $iteration -lt $MaxIterations)) {
  $iteration += 1
  foreach ($command in $commands) {
    $logPath = Join-Path $campaignDirectory ("local-{0:d3}-{1}.log" -f $iteration, $command.name)
    $started = [DateTime]::UtcNow
    $processEnvironment = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process)
    $hadTsxDisableCache = $processEnvironment.Contains('TSX_DISABLE_CACHE')
    $previousTsxDisableCache = [Environment]::GetEnvironmentVariable('TSX_DISABLE_CACHE', [EnvironmentVariableTarget]::Process)
    $exitCode = 1
    $launchError = $null
    $errorCountBeforeLaunch = $Error.Count
    $global:LASTEXITCODE = 1
    try {
      [Environment]::SetEnvironmentVariable('TSX_DISABLE_CACHE', '1', [EnvironmentVariableTarget]::Process)
      & $runtime @($command.arguments) *> $logPath
      if ($null -ne $LASTEXITCODE) { $exitCode = $LASTEXITCODE }
      if ($Error.Count -gt $errorCountBeforeLaunch) { $launchError = 'child-launch-failed' }
    } catch {
      $launchError = 'child-launch-failed'
    } finally {
      try {
        if ($hadTsxDisableCache) {
          [Environment]::SetEnvironmentVariable('TSX_DISABLE_CACHE', $previousTsxDisableCache, [EnvironmentVariableTarget]::Process)
        } elseif (Test-Path -LiteralPath 'Env:TSX_DISABLE_CACHE') {
          Remove-Item -LiteralPath 'Env:TSX_DISABLE_CACHE' -Force -ErrorAction Stop
        }
      } catch {
        $exitCode = 1
        $launchError = 'campaign-environment-restore-failed'
      }
    }
    $elapsedMs = [int]([DateTime]::UtcNow - $started).TotalMilliseconds
    $event = @{
      status = if ($exitCode -eq 0) { 'passed' } else { 'failed' }
      iteration = $iteration
      command = $command.name
      exitCode = $exitCode
      elapsedMs = $elapsedMs
      log = (Split-Path -Leaf $logPath)
    }
    if ($null -ne $launchError) { $event.launchError = $launchError }
    Write-CampaignEvent $event
    if ($exitCode -ne 0) {
      Write-CampaignEvent @{ status = 'stopped-on-failure'; iteration = $iteration; command = $command.name; exitCode = $exitCode }
      exit $exitCode
    }
  }

  if ($MaxIterations -ne 0 -and $iteration -ge $MaxIterations) { break }
  $remainingMs = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds
  if ($remainingMs -le 0) { break }
  Start-Sleep -Seconds ([Math]::Min($IntervalMinutes * 60, [Math]::Floor($remainingMs / 1000)))
}

Write-CampaignEvent @{ status = 'completed'; iterations = $iteration }
