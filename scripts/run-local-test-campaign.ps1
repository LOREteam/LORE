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
$campaignRoot = Join-Path $repoRoot 'artifacts\test-campaign-2026-08-20'
$campaignDirectory = Join-Path $campaignRoot $CampaignId
$summaryPath = Join-Path $campaignDirectory 'local-test-campaign.jsonl'

function Get-CampaignSourceSha {
  $headLines = @(& git -C $repoRoot rev-parse --verify 'HEAD^{commit}' 2>$null)
  $headExitCode = $LASTEXITCODE
  if ($headExitCode -ne 0 -or $headLines.Count -ne 1) {
    throw 'Local test campaign requires a canonical Git HEAD.'
  }
  $head = [string]$headLines[0]
  if ($head -notmatch '^[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$') {
    throw 'Local test campaign requires a canonical Git commit SHA.'
  }

  $trackedChanges = @(& git -C $repoRoot status --porcelain=v1 --untracked-files=no 2>$null)
  $statusExitCode = $LASTEXITCODE
  if ($statusExitCode -ne 0) {
    throw 'Local test campaign could not verify tracked worktree state.'
  }
  if ($trackedChanges.Count -ne 0) {
    throw 'Local test campaign requires a clean tracked worktree.'
  }
  return $head.ToLowerInvariant()
}

function Get-CampaignSourceIntegrityFailure(
  [string]$ExpectedSourceSha,
  [AllowEmptyString()][string]$ExpectedTrackedMetadata,
  [string]$SourceRoot = $repoRoot
) {
  $headLines = @(& git -C $SourceRoot rev-parse --verify 'HEAD^{commit}' 2>$null)
  $headExitCode = $LASTEXITCODE
  if ($headExitCode -ne 0 -or $headLines.Count -ne 1) {
    return 'source-drift'
  }
  $head = [string]$headLines[0]
  if ($head -notmatch '^[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$' -or -not [string]::Equals($head, $ExpectedSourceSha, [StringComparison]::OrdinalIgnoreCase)) {
    return 'source-drift'
  }

  $trackedChanges = @(& git -C $SourceRoot status --porcelain=v1 --untracked-files=no 2>$null)
  $statusExitCode = $LASTEXITCODE
  if ($statusExitCode -ne 0 -or $trackedChanges.Count -ne 0) {
    return 'tracked-tree-dirty'
  }
  if ($PSBoundParameters.ContainsKey('ExpectedTrackedMetadata')) {
    $actualTrackedMetadata = Get-CampaignTrackedMetadata $SourceRoot
    if ($null -eq $actualTrackedMetadata -or -not [string]::Equals($actualTrackedMetadata, $ExpectedTrackedMetadata, [StringComparison]::Ordinal)) {
      return 'tracked-tree-dirty'
    }
  }
  return $null
}

function Get-CampaignTrackedMetadata([string]$SourceRoot = $repoRoot) {
  $trackedPaths = @(& git -C $SourceRoot ls-files --full-name 2>$null)
  $trackedPathsExitCode = $LASTEXITCODE
  if ($trackedPathsExitCode -ne 0) {
    return $null
  }
  $metadata = [Collections.Generic.List[string]]::new()
  foreach ($relativePath in $trackedPaths) {
    try {
      $item = Get-Item -LiteralPath (Join-Path $SourceRoot $relativePath) -Force -ErrorAction Stop
      if ($item.PSIsContainer) {
        return $null
      }
      [void]$metadata.Add(("{0}`0{1}`0{2}" -f $relativePath, $item.Length, $item.LastWriteTimeUtc.Ticks))
    } catch {
      return $null
    }
  }
  return [string]::Join("`n", $metadata)
}

$sourceSha = Get-CampaignSourceSha
$snapshotParent = Join-Path ([IO.Path]::GetTempPath()) 'lore-local-test-campaign-source-snapshots'
$snapshotDirectory = Join-Path $snapshotParent ("{0}-{1}" -f $CampaignId, $sourceSha)
$snapshotNodeModules = Join-Path $snapshotDirectory 'node_modules'
$snapshotCreated = $false
$snapshotNodeModulesLinked = $false

function Assert-CampaignSnapshotPath {
  $snapshotParentFull = [IO.Path]::GetFullPath($snapshotParent)
  $snapshotFull = [IO.Path]::GetFullPath($snapshotDirectory)
  if (-not $snapshotFull.StartsWith($snapshotParentFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Local test campaign snapshot path is outside its temporary root.'
  }
}

function New-CampaignSourceSnapshot {
  Assert-CampaignSnapshotPath
  if (Test-Path -LiteralPath $snapshotDirectory) {
    throw 'Local test campaign requires a new isolated source snapshot.'
  }
  New-Item -ItemType Directory -Force -Path $snapshotParent -ErrorAction Stop | Out-Null
  & git -C $repoRoot worktree add --detach $snapshotDirectory $sourceSha 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'Local test campaign could not create an isolated source snapshot.'
  }
  $script:snapshotCreated = $true
  $snapshotIntegrityFailure = Get-CampaignSourceIntegrityFailure -ExpectedSourceSha $sourceSha -SourceRoot $snapshotDirectory
  if ($null -ne $snapshotIntegrityFailure) {
    throw 'Local test campaign isolated source snapshot did not match the requested commit.'
  }
  $sourceNodeModules = Join-Path $repoRoot 'node_modules'
  if (-not (Test-Path -LiteralPath $sourceNodeModules -PathType Container)) {
    throw 'Local test campaign requires installed dependencies for the isolated source snapshot.'
  }
  if (-not (Test-Path -LiteralPath $snapshotNodeModules -PathType Container)) {
    New-Item -ItemType Junction -Path $snapshotNodeModules -Target $sourceNodeModules -ErrorAction Stop | Out-Null
    $script:snapshotNodeModulesLinked = $true
  }
}

function Remove-CampaignSourceSnapshot {
  if (-not $snapshotCreated) { return }
  Assert-CampaignSnapshotPath
  if ($snapshotNodeModulesLinked -and (Test-Path -LiteralPath $snapshotNodeModules)) {
    $nodeModulesItem = Get-Item -LiteralPath $snapshotNodeModules -Force -ErrorAction Stop
    $expectedTarget = [IO.Path]::GetFullPath((Join-Path $repoRoot 'node_modules')).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $actualTargets = @($nodeModulesItem.Target | ForEach-Object { [IO.Path]::GetFullPath([string]$_).TrimEnd([IO.Path]::DirectorySeparatorChar) })
    if (-not $nodeModulesItem.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or $actualTargets.Count -ne 1 -or -not [string]::Equals($actualTargets[0], $expectedTarget, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Local test campaign isolated source snapshot dependency link is unsafe to remove.'
    }
    Remove-Item -LiteralPath $snapshotNodeModules -Force -ErrorAction Stop
  }
  & git -C $repoRoot worktree remove --force $snapshotDirectory 2>$null
  if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $snapshotDirectory)) {
    throw 'Local test campaign could not clean up its isolated source snapshot.'
  }
  $script:snapshotCreated = $false
  $script:snapshotNodeModulesLinked = $false
}

if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) {
  throw "Private Node runtime is unavailable: $runtime"
}
try {
  New-Item -ItemType Directory -Force -Path $campaignRoot -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $campaignDirectory -ErrorAction Stop | Out-Null
} catch {
  throw 'Local test campaign requires a new campaign directory.'
}
try {
  New-CampaignSourceSnapshot
} catch {
  try { Remove-CampaignSourceSnapshot } catch {}
  throw $_
}

function Write-CampaignEvent([hashtable]$Event) {
  if ($Event.ContainsKey('sourceSha')) {
    throw 'Campaign event source SHA is assigned by the runner.'
  }
  $record = [ordered]@{
    timestamp = [DateTime]::UtcNow.ToString('o')
    sourceSha = $sourceSha
  }
  foreach ($key in $Event.Keys) {
    $record[$key] = $Event[$key]
  }
  try {
    $serialized = $record | ConvertTo-Json -Compress -ErrorAction Stop
    Add-Content -LiteralPath $summaryPath -Value $serialized -Encoding utf8 -ErrorAction Stop
  } catch {
    throw 'Local test campaign could not record evidence.'
  }
}

function Stop-CampaignForSourceIntegrityFailure(
  [int]$Iteration,
  [string]$Phase,
  [string]$Failure,
  [string]$CommandName
) {
  $event = @{
    status = 'failed'
    iteration = $Iteration
    phase = $Phase
    sourceIntegrityFailure = $Failure
    exitCode = 1
  }
  if (-not [string]::IsNullOrWhiteSpace($CommandName)) {
    $event.command = $CommandName
  }
  Write-CampaignEvent $event
  $stoppedEvent = @{
    status = 'stopped-on-failure'
    iteration = $Iteration
    phase = $Phase
    sourceIntegrityFailure = $Failure
    exitCode = 1
  }
  if (-not [string]::IsNullOrWhiteSpace($CommandName)) {
    $stoppedEvent.command = $CommandName
  }
  Write-CampaignEvent $stoppedEvent
  exit 1
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
$campaignSucceeded = $false
try {
Write-CampaignEvent @{ status = 'started'; campaignId = $CampaignId; hours = $Hours; intervalMinutes = $IntervalMinutes; deadlineUtc = $deadline.ToString('o'); executionSource = 'detached-worktree' }

while ([DateTime]::UtcNow -lt $deadline -and ($MaxIterations -eq 0 -or $iteration -lt $MaxIterations)) {
  $iteration += 1
  foreach ($command in $commands) {
    $sourceIntegrityFailure = Get-CampaignSourceIntegrityFailure $sourceSha
    if ($null -ne $sourceIntegrityFailure) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-command' -Failure $sourceIntegrityFailure -CommandName $command.name
    }
    $trackedMetadataBefore = Get-CampaignTrackedMetadata
    if ($null -eq $trackedMetadataBefore) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-command' -Failure 'tracked-tree-dirty' -CommandName $command.name
    }
    $snapshotMetadataBefore = Get-CampaignTrackedMetadata $snapshotDirectory
    if ($null -eq $snapshotMetadataBefore) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-command' -Failure 'source-snapshot-dirty' -CommandName $command.name
    }
    $logPath = Join-Path $campaignDirectory ("local-{0:d3}-{1}.log" -f $iteration, $command.name)
    $started = [DateTime]::UtcNow
    $processEnvironment = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process)
    $hadTsxDisableCache = $processEnvironment.Contains('TSX_DISABLE_CACHE')
    $previousTsxDisableCache = [Environment]::GetEnvironmentVariable('TSX_DISABLE_CACHE', [EnvironmentVariableTarget]::Process)
    $exitCode = 1
    $launchError = $null
    $global:LASTEXITCODE = 1
    try {
      [Environment]::SetEnvironmentVariable('TSX_DISABLE_CACHE', '1', [EnvironmentVariableTarget]::Process)
      Push-Location -LiteralPath $snapshotDirectory
      try {
        & $runtime @($command.arguments) *> $logPath
      } finally {
        Pop-Location
      }
      if ($null -ne $LASTEXITCODE) { $exitCode = $LASTEXITCODE }
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
    $postChildIntegrityFailure = Get-CampaignSourceIntegrityFailure $sourceSha $trackedMetadataBefore
    if ($null -ne $postChildIntegrityFailure) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'after-command' -Failure $postChildIntegrityFailure -CommandName $command.name
    }
    $postChildSnapshotIntegrityFailure = Get-CampaignSourceIntegrityFailure $sourceSha $snapshotMetadataBefore $snapshotDirectory
    if ($null -ne $postChildSnapshotIntegrityFailure) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'after-command' -Failure 'source-snapshot-dirty' -CommandName $command.name
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

$completionIntegrityFailure = Get-CampaignSourceIntegrityFailure $sourceSha
if ($null -ne $completionIntegrityFailure) {
  Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure $completionIntegrityFailure -CommandName $null
}
$campaignSucceeded = $true
} finally {
  Remove-CampaignSourceSnapshot
}
$completionIntegrityFailure = Get-CampaignSourceIntegrityFailure $sourceSha
if ($null -ne $completionIntegrityFailure) {
  Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure $completionIntegrityFailure -CommandName $null
}
if ($campaignSucceeded) {
  Write-CampaignEvent @{ status = 'completed'; iterations = $iteration }
}
