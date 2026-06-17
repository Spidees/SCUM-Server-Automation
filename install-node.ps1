# Downloads and silently installs the latest Node.js LTS.
# Invoked by Start.bat when Node.js isn't found and winget isn't available.
$ErrorActionPreference = 'Stop'

try {
    # Windows PowerShell 5.1 defaults to TLS 1.0, which nodejs.org rejects.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

    Write-Host ' [Setup] Fetching latest Node.js LTS version...'
    $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $version = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
    if (-not $version) { $version = ($index | Select-Object -First 1).version }
    if (-not $version) { throw 'Could not determine a Node.js version from nodejs.org.' }

    $url = "https://nodejs.org/dist/$version/node-$version-$arch.msi"
    $msi = Join-Path $env:TEMP 'nodejs_setup.msi'

    Write-Host " [Setup] Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing

    Write-Host ' [Setup] Installing Node.js (silent)...'
    $proc = Start-Process msiexec -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "msiexec exited with code $($proc.ExitCode)." }

    Remove-Item $msi -ErrorAction SilentlyContinue
    Write-Host ' [Setup] Node.js installation finished.'
    exit 0
} catch {
    Write-Host " [ERROR] Node.js install failed: $($_.Exception.Message)"
    exit 1
}
