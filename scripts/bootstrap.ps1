param([Parameter(ValueFromRemainingArguments=$true)][string[]]$LaunchArgs)

$ErrorActionPreference = 'Stop'

function Test-StudioNode {
    param([string]$NodePath)
    if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { return $false }
    $npmCli = Join-Path (Split-Path -Parent $NodePath) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { return $false }
    try {
        $versionText = (& $NodePath --version 2>$null | Out-String).Trim()
        return ($LASTEXITCODE -eq 0 -and $versionText -match '^v(\d+)\.\d+\.\d+$' -and [int]$Matches[1] -ge 22)
    } catch { return $false }
}

function Assert-StudioArchive {
    param([string]$Archive, [string]$ExpectedHash)
    $stream = [IO.File]::OpenRead($Archive)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($ExpectedHash -notmatch '^[a-f0-9]{64}$' -or $actual -ne $ExpectedHash) {
        throw 'NODE_DOWNLOAD_CHECKSUM_FAILED: archive was not installed.'
    }
}

function Expand-StudioArchive {
    param([string]$Archive, [string]$Destination, [string]$ExpectedHash)
    Assert-StudioArchive $Archive $ExpectedHash
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fullDestination = [IO.Path]::GetFullPath($Destination)
    if ($fullDestination.StartsWith('\\')) { $fullDestination = '\\?\UNC\' + $fullDestination.Substring(2) }
    else { $fullDestination = '\\?\' + $fullDestination }
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            # Extended Windows paths require backslashes, including ZIP member names.
            $relative = $entry.FullName.Replace('/','\')
            if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|\\)\.\.?(\\|$)' -or $relative.Contains(':')) { throw 'NODE_ARCHIVE_PATH_INVALID' }
            $target = $fullDestination.TrimEnd('\') + '\' + $relative
            if ($relative.EndsWith('\')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            $inputStream = $entry.Open()
            try {
                $outputStream = [IO.File]::Open($target,[IO.FileMode]::CreateNew)
                try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
            } finally { $inputStream.Dispose() }
        }
    } finally { $zip.Dispose() }
}

function Get-StudioNode {
    param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'GeminiNarrationStudio\runtime'))
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($architecture -ne 'AMD64') { throw 'WINDOWS_X64_REQUIRED: this distribution supports Windows x64.' }
    $installed = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($installed -and (Test-StudioNode $installed.Source)) { return $installed.Source }
    # Official Windows ZIP, pinned and checked before extraction; no admin or system PATH changes.
    $folder = 'node-v22.23.3-win-x64'
    $expectedHash = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71'
    $destination = Join-Path $CacheRoot $folder
    $nodePath = Join-Path $destination 'node.exe'
    if (Test-StudioNode $nodePath) { return $nodePath }
    if (Test-Path -LiteralPath $destination) { throw 'NODE_CACHE_INCOMPLETE: restore this runtime folder or install Node.js 22+ with npm.' }
    New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
    $scratch = Join-Path $CacheRoot ('.setup-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch | Out-Null
    try {
        Write-Host 'First start: downloading Node.js from nodejs.org. Please wait...'
        $ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $archive = Join-Path $scratch 'node.zip'
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 -Uri ('https://nodejs.org/dist/v22.23.3/' + $folder + '.zip') -OutFile $archive
        Expand-StudioArchive $archive $scratch $expectedHash
        $extracted = Join-Path $scratch $folder
        if (-not (Test-StudioNode (Join-Path $extracted 'node.exe'))) { throw 'NODE_INSTALL_VERIFICATION_FAILED' }
        $cacheFull = [IO.Path]::GetFullPath($CacheRoot).TrimEnd('\') + '\'
        if (-not [IO.Path]::GetFullPath($extracted).StartsWith($cacheFull,[StringComparison]::OrdinalIgnoreCase) -or
            -not [IO.Path]::GetFullPath($destination).StartsWith($cacheFull,[StringComparison]::OrdinalIgnoreCase)) { throw 'NODE_CACHE_PATH_INVALID' }
        Move-Item -LiteralPath $extracted -Destination $destination
        return $nodePath
    } finally {
        $cacheFull = [IO.Path]::GetFullPath($CacheRoot).TrimEnd('\') + '\'
        $scratchFull = [IO.Path]::GetFullPath($scratch)
        if ($scratchFull.StartsWith($cacheFull,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $scratchFull) -match '^\.setup-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $scratchFull -Recurse -Force
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $studioNode = Get-StudioNode
        $env:PATH = (Split-Path -Parent $studioNode) + ';' + $env:PATH
        & $studioNode (Join-Path (Split-Path -Parent $PSScriptRoot) 'launch.mjs') @LaunchArgs
        exit $LASTEXITCODE
    } catch {
        Write-Host ('STUDIO_START_FAILED: ' + $_.Exception.Message) -ForegroundColor Red
        Write-Host 'Check your network and folder permissions, then run the batch again. Manual Node.js setup: https://nodejs.org/en/download/'
        exit 1
    }
}
