[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string[]]$Domain,

    [ValidateRange(16, 512)]
    [int]$Size = 128,

    [string]$Output
)

$ErrorActionPreference = 'Stop'
$apiEndpoint = 'https://favicondl.com/api/extract'

function Get-SafeName {
    param([string]$Value)

    $candidate = $Value.Trim()
    if ($candidate -notmatch '^https?://') {
        $candidate = "https://$candidate"
    }

    try {
        $hostName = ([Uri]$candidate).Host
    } catch {
        $hostName = $Value.Trim()
    }

    $safe = $hostName -replace '^www\.', '' -replace '[^a-zA-Z0-9_-]', '_'
    if ([string]::IsNullOrWhiteSpace($safe)) {
        throw "Invalid domain or URL: $Value"
    }

    return $safe
}

function Get-OutputPath {
    param(
        [string]$Target,
        [string]$RequestedOutput,
        [bool]$Multiple
    )

    $safeName = Get-SafeName $Target
    if ([string]::IsNullOrWhiteSpace($RequestedOutput)) {
        return Join-Path (Get-Location) "${safeName}_favicon.img"
    }

    if ($Multiple -or (Test-Path -LiteralPath $RequestedOutput -PathType Container)) {
        if (-not (Test-Path -LiteralPath $RequestedOutput)) {
            New-Item -ItemType Directory -Path $RequestedOutput -Force | Out-Null
        }
        return Join-Path $RequestedOutput "${safeName}_favicon.img"
    }

    return $RequestedOutput
}

$multiple = $Domain.Count -gt 1
foreach ($target in $Domain) {
    $destination = Get-OutputPath $target $Output $multiple
    $parent = Split-Path -Parent $destination
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $encodedTarget = [Uri]::EscapeDataString($target.Trim())
    $requestUrl = $apiEndpoint + "?url=$encodedTarget&size=$Size"

    Write-Host "Fetching favicon for $target at ${Size}px..."
    Invoke-WebRequest -Uri $requestUrl -OutFile $destination -MaximumRedirection 5 -TimeoutSec 30
    $bytes = (Get-Item -LiteralPath $destination).Length
    Write-Host "Saved: $destination ($bytes bytes)"
}
