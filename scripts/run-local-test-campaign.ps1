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

function Initialize-CampaignPathIdentity {
  if ($null -ne ('LoreCampaignNativePathIdentity' -as [type])) { return }
  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class LoreCampaignNativePathIdentity {
  [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
    public uint FileAttributes; public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime; public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime; public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime; public uint VolumeSerialNumber; public uint FileSizeHigh; public uint FileSizeLow; public uint NumberOfLinks; public uint FileIndexHigh; public uint FileIndexLow;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string path, uint access, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);
  [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
  public static string GetIdentity(string path, bool directory) {
    const uint readAttributes = 0x80, shareRead = 0x1, shareWrite = 0x2, shareDelete = 0x4, openExisting = 3, backupSemantics = 0x02000000;
    using (SafeFileHandle handle = CreateFile(path, readAttributes, shareRead | shareWrite | shareDelete, IntPtr.Zero, openExisting, directory ? backupSemantics : 0, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      FileInformation information; if (!GetFileInformationByHandle(handle, out information)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return string.Format("{0:X8}:{1:X8}{2:X8}", information.VolumeSerialNumber, information.FileIndexHigh, information.FileIndexLow);
    }
  }
}
"@ -ErrorAction Stop
}

function Get-CampaignOrdinaryDirectoryState([string]$Path) {
  try {
    $fullPath = [IO.Path]::GetFullPath($Path); $rootPath = [IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrWhiteSpace($rootPath)) { return $null }
    $currentPath = $rootPath; $rootItem = Get-Item -LiteralPath $currentPath -Force -ErrorAction Stop
    if (-not $rootItem.PSIsContainer -or $rootItem.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { return $null }
    $relativePath = $fullPath.Substring($rootPath.Length).Trim([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if (-not [string]::IsNullOrEmpty($relativePath)) {
      foreach ($segment in $relativePath.Split(@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar), [StringSplitOptions]::RemoveEmptyEntries)) {
        $currentPath = Join-Path $currentPath $segment; $item = Get-Item -LiteralPath $currentPath -Force -ErrorAction Stop
        if (-not $item.PSIsContainer -or $item.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { return $null }
      }
    }
    Initialize-CampaignPathIdentity
    return ("{0}`0{1}" -f $fullPath, [LoreCampaignNativePathIdentity]::GetIdentity($fullPath, $true))
  } catch { return $null }
}

function Get-CampaignSha256([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '') } finally { $sha256.Dispose() }
  } finally { $stream.Dispose() }
}

function Get-CampaignRegularFileSnapshot([string]$Path) {
  try {
    $fullPath = [IO.Path]::GetFullPath($Path); $parentState = Get-CampaignOrdinaryDirectoryState (Split-Path -Parent $fullPath)
    if ($null -eq $parentState) { return $null }
    $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
    if ($item.PSIsContainer) { return $null }
    Initialize-CampaignPathIdentity; $hash = (Get-CampaignSha256 $fullPath)
    return ("{0}`0{1}`0{2}`0{3}`0{4}`0{5}" -f $fullPath, $parentState, [LoreCampaignNativePathIdentity]::GetIdentity($fullPath, $false), $item.Length, $item.LastWriteTimeUtc.Ticks, $hash)
  } catch { return $null }
}

function Get-CampaignProtectedDatabaseSnapshot {
  $records = [Collections.Generic.List[string]]::new()
  foreach ($relativePath in @('data\lore-v10.sqlite', 'data\lore-v10.sqlite-wal', 'data\lore-v10.sqlite-shm')) {
    $fullPath = Join-Path $repoRoot $relativePath
    if (-not (Test-Path -LiteralPath $fullPath)) { [void]$records.Add("$relativePath`0absent"); continue }
    $snapshot = Get-CampaignRegularFileSnapshot $fullPath
    if ($null -eq $snapshot) { return $null }
    [void]$records.Add("$relativePath`0present`0$snapshot")
  }
  return [string]::Join("`n", $records)
}

function Get-CampaignRuntimeFileSnapshot {
  try { return (Get-CampaignSha256 $runtime) } catch { return $null }
}
function Get-CampaignRuntimeDependencySnapshot {
  $runtimeSnapshot = Get-CampaignRuntimeFileSnapshot
  $nodeModulesSnapshot = Get-CampaignOrdinaryDirectoryState (Join-Path $repoRoot 'node_modules')
  $lockfileSnapshot = Get-CampaignRegularFileSnapshot (Join-Path $repoRoot 'package-lock.json')
  if ($null -eq $runtimeSnapshot -or $null -eq $nodeModulesSnapshot -or $null -eq $lockfileSnapshot) { return $null }
  return [PSCustomObject]@{ runtime = $runtimeSnapshot; nodeModules = $nodeModulesSnapshot; lockfile = $lockfileSnapshot }
}

function Test-CampaignRuntimeDependencySnapshot($ExpectedSnapshot) {
  if ($null -eq $ExpectedSnapshot) { return $false }
  $actualSnapshot = Get-CampaignRuntimeDependencySnapshot
  return $null -ne $actualSnapshot -and [string]::Equals($actualSnapshot.runtime, $ExpectedSnapshot.runtime, [StringComparison]::Ordinal) -and [string]::Equals($actualSnapshot.nodeModules, $ExpectedSnapshot.nodeModules, [StringComparison]::Ordinal) -and [string]::Equals($actualSnapshot.lockfile, $ExpectedSnapshot.lockfile, [StringComparison]::Ordinal)
}

function Get-CampaignSourceIntegrityFailure([string]$ExpectedSourceSha, [AllowEmptyString()][string]$ExpectedTrackedMetadata, [string]$SourceRoot = $repoRoot, [bool]$IncludeContentSha256 = $false) {
  $headLines = @(& git -C $SourceRoot rev-parse --verify 'HEAD^{commit}' 2>$null); $headExitCode = $LASTEXITCODE
  if ($headExitCode -ne 0 -or $headLines.Count -ne 1) { return 'source-drift' }
  $head = [string]$headLines[0]
  if ($head -notmatch '^[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$' -or -not [string]::Equals($head, $ExpectedSourceSha, [StringComparison]::OrdinalIgnoreCase)) { return 'source-drift' }
  $trackedChanges = @(& git -C $SourceRoot status --porcelain=v1 --untracked-files=no 2>$null); $statusExitCode = $LASTEXITCODE
  if ($statusExitCode -ne 0 -or $trackedChanges.Count -ne 0) { return 'tracked-tree-dirty' }
  if ($PSBoundParameters.ContainsKey('ExpectedTrackedMetadata')) {
    $actualTrackedMetadata = Get-CampaignTrackedMetadata $SourceRoot $IncludeContentSha256
    if ($null -eq $actualTrackedMetadata -or -not [string]::Equals($actualTrackedMetadata, $ExpectedTrackedMetadata, [StringComparison]::Ordinal)) { return 'tracked-tree-dirty' }
  }
  return $null
}

function Get-CampaignTrackedMetadata([string]$SourceRoot = $repoRoot, [bool]$IncludeContentSha256 = $false) {
  $trackedPaths = @(& git -C $SourceRoot ls-files --full-name 2>$null)
  if ($LASTEXITCODE -ne 0) { return $null }
  $metadata = [Collections.Generic.List[string]]::new()
  foreach ($relativePath in $trackedPaths) {
    try {
      $item = Get-Item -LiteralPath (Join-Path $SourceRoot $relativePath) -Force -ErrorAction Stop
      if ($item.PSIsContainer) { return $null }
      $contentHash = if ($IncludeContentSha256) { (Get-CampaignSha256 $item.FullName) } else { '' }
      [void]$metadata.Add(("{0}`0{1}`0{2}`0{3}" -f $relativePath, $item.Length, $item.LastWriteTimeUtc.Ticks, $contentHash))
    } catch { return $null }
  }
  return [string]::Join("`n", $metadata)
}
$sourceSha = Get-CampaignSourceSha
if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) { throw "Private Node runtime is unavailable: $runtime" }
$protectedDatabaseSnapshot = Get-CampaignProtectedDatabaseSnapshot
if ($null -eq $protectedDatabaseSnapshot) { throw 'Local test campaign could not snapshot protected database state.' }
$runtimeDependencySnapshot = Get-CampaignRuntimeDependencySnapshot
if ($null -eq $runtimeDependencySnapshot) { throw 'Local test campaign requires an ordinary private runtime, node_modules directory, and package lockfile.' }
$snapshotParent = Join-Path ([IO.Path]::GetTempPath()) 'lore-local-test-campaign-source-snapshots'
$snapshotDirectory = Join-Path $snapshotParent ("{0}-{1}" -f $CampaignId, $sourceSha)
$snapshotNodeModules = Join-Path $snapshotDirectory 'node_modules'
$snapshotCreated = $false; $snapshotNodeModulesLinked = $false; $snapshotParentIdentity = $null; $snapshotDirectoryIdentity = $null

function Assert-CampaignSnapshotPath {
  $snapshotParentFull = [IO.Path]::GetFullPath($snapshotParent); $snapshotFull = [IO.Path]::GetFullPath($snapshotDirectory)
  if (-not $snapshotFull.StartsWith($snapshotParentFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Local test campaign snapshot path is outside its temporary root.' }
}
function Test-CampaignSnapshotPathIdentity {
  try { Assert-CampaignSnapshotPath; $parent = Get-CampaignOrdinaryDirectoryState $snapshotParent; $snapshot = Get-CampaignOrdinaryDirectoryState $snapshotDirectory; return $null -ne $parent -and $null -ne $snapshot -and [string]::Equals($parent,$snapshotParentIdentity,[StringComparison]::Ordinal) -and [string]::Equals($snapshot,$snapshotDirectoryIdentity,[StringComparison]::Ordinal) } catch { return $false }
}
function Test-CampaignSnapshotDependencyLink {
  try {
    if (-not $snapshotNodeModulesLinked -or -not (Test-Path -LiteralPath $snapshotNodeModules -PathType Container)) { return $false }
    $item=Get-Item -LiteralPath $snapshotNodeModules -Force -ErrorAction Stop; $expected=[IO.Path]::GetFullPath($runtimeDependencySnapshot.nodeModules.Split([char]0)[0]).TrimEnd([IO.Path]::DirectorySeparatorChar); $actual=@($item.Target | ForEach-Object {[IO.Path]::GetFullPath([string]$_).TrimEnd([IO.Path]::DirectorySeparatorChar)})
    if (-not $item.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or $actual.Count -ne 1 -or -not [string]::Equals($actual[0],$expected,[StringComparison]::OrdinalIgnoreCase)) { return $false }
    $state=Get-CampaignOrdinaryDirectoryState $actual[0]; return $null -ne $state -and [string]::Equals($state,$runtimeDependencySnapshot.nodeModules,[StringComparison]::Ordinal)
  } catch { return $false }
}
function New-CampaignSourceSnapshot {
  Assert-CampaignSnapshotPath
  if (Test-Path -LiteralPath $snapshotDirectory) { throw 'Local test campaign requires a new isolated source snapshot.' }
  New-Item -ItemType Directory -Force -Path $snapshotParent -ErrorAction Stop | Out-Null
  $script:snapshotParentIdentity=Get-CampaignOrdinaryDirectoryState $snapshotParent
  if ($null -eq $snapshotParentIdentity) { throw 'Local test campaign snapshot parent must be an ordinary directory.' }
  & git -C $repoRoot worktree add --detach $snapshotDirectory $sourceSha 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Local test campaign could not create an isolated source snapshot.' }
  $script:snapshotCreated=$true; $script:snapshotDirectoryIdentity=Get-CampaignOrdinaryDirectoryState $snapshotDirectory
  if (-not (Test-CampaignSnapshotPathIdentity)) { throw 'Local test campaign isolated source snapshot path identity changed.' }
  $failure=Get-CampaignSourceIntegrityFailure -ExpectedSourceSha $sourceSha -SourceRoot $snapshotDirectory
  if ($null -ne $failure) { throw 'Local test campaign isolated source snapshot did not match the requested commit.' }
  if (Test-Path -LiteralPath $snapshotNodeModules) { throw 'Local test campaign isolated source snapshot has an unexpected dependency directory.' }
  New-Item -ItemType Junction -Path $snapshotNodeModules -Target ($runtimeDependencySnapshot.nodeModules.Split([char]0)[0]) -ErrorAction Stop | Out-Null
  $script:snapshotNodeModulesLinked=$true
  if (-not (Test-CampaignSnapshotDependencyLink)) { throw 'Local test campaign isolated source snapshot dependency link failed validation.' }
}
function Remove-CampaignSourceSnapshot {
  if (-not $snapshotCreated) { return }
  if (-not (Test-CampaignSnapshotPathIdentity)) { throw 'Local test campaign isolated source snapshot path identity changed before cleanup.' }
  if (-not (Test-CampaignRuntimeDependencySnapshot $runtimeDependencySnapshot)) { throw 'Local test campaign runtime or dependency identity changed before cleanup.' }
  if (-not (Test-CampaignSnapshotDependencyLink)) { throw 'Local test campaign isolated source snapshot dependency link is unsafe to remove.' }
  [IO.Directory]::Delete($snapshotNodeModules, $false)
  & git -C $repoRoot worktree remove --force $snapshotDirectory 2>$null
  if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $snapshotDirectory)) { throw 'Local test campaign could not clean up its isolated source snapshot.' }
  $script:snapshotCreated=$false; $script:snapshotNodeModulesLinked=$false
}if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) {
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
    if (-not (Test-CampaignSnapshotPathIdentity)) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-command' -Failure 'source-snapshot-path-drift' -CommandName $command.name
    }
    if (-not (Test-CampaignRuntimeDependencySnapshot $runtimeDependencySnapshot)) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-command' -Failure 'runtime-dependency-drift' -CommandName $command.name
    }
    if (-not (Test-CampaignSnapshotDependencyLink)) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-command' -Failure 'source-snapshot-dependency-drift' -CommandName $command.name
    }
    if (-not [string]::Equals((Get-CampaignProtectedDatabaseSnapshot), $protectedDatabaseSnapshot, [StringComparison]::Ordinal)) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-command' -Failure 'protected-db-drift' -CommandName $command.name
    }
    $snapshotMetadataBefore = Get-CampaignTrackedMetadata $snapshotDirectory $true
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
    if (-not (Test-CampaignSnapshotPathIdentity)) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'after-command' -Failure 'source-snapshot-path-drift' -CommandName $command.name
    }
    if (-not (Test-CampaignRuntimeDependencySnapshot $runtimeDependencySnapshot)) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'after-command' -Failure 'runtime-dependency-drift' -CommandName $command.name
    }
    if (-not (Test-CampaignSnapshotDependencyLink)) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'after-command' -Failure 'source-snapshot-dependency-drift' -CommandName $command.name
    }
    if (-not [string]::Equals((Get-CampaignProtectedDatabaseSnapshot), $protectedDatabaseSnapshot, [StringComparison]::Ordinal)) {
      Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'after-command' -Failure 'protected-db-drift' -CommandName $command.name
    }
    $postChildSnapshotIntegrityFailure = Get-CampaignSourceIntegrityFailure $sourceSha $snapshotMetadataBefore $snapshotDirectory $true
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
if (-not (Test-CampaignSnapshotPathIdentity)) { Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure 'source-snapshot-path-drift' -CommandName $null }
if (-not (Test-CampaignRuntimeDependencySnapshot $runtimeDependencySnapshot)) { Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure 'runtime-dependency-drift' -CommandName $null }
if (-not (Test-CampaignSnapshotDependencyLink)) { Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure 'source-snapshot-dependency-drift' -CommandName $null }
if (-not [string]::Equals((Get-CampaignProtectedDatabaseSnapshot), $protectedDatabaseSnapshot, [StringComparison]::Ordinal)) { Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure 'protected-db-drift' -CommandName $null }
$campaignSucceeded = $true
} finally {
  Remove-CampaignSourceSnapshot
}
$completionIntegrityFailure = Get-CampaignSourceIntegrityFailure $sourceSha
if ($null -ne $completionIntegrityFailure) {
  Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure $completionIntegrityFailure -CommandName $null
}
if (-not (Test-CampaignRuntimeDependencySnapshot $runtimeDependencySnapshot)) { Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure 'runtime-dependency-drift' -CommandName $null }
if (-not [string]::Equals((Get-CampaignProtectedDatabaseSnapshot), $protectedDatabaseSnapshot, [StringComparison]::Ordinal)) { Stop-CampaignForSourceIntegrityFailure -Iteration $iteration -Phase 'before-completed' -Failure 'protected-db-drift' -CommandName $null }
if ($campaignSucceeded) {
  Write-CampaignEvent @{ status = 'completed'; iterations = $iteration }
}
