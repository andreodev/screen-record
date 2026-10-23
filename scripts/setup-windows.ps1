$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'src-tauri/resources/ffmpeg'

# Install the versioned Gyan Essentials package using WinGet's manifest hash.
$packageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
$package = Get-ChildItem -LiteralPath $packageRoot -Directory -Filter 'Gyan.FFmpeg.Essentials*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $package) {
    winget install --id Gyan.FFmpeg.Essentials --exact --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar o FFmpeg.' }
    $package = Get-ChildItem -LiteralPath $packageRoot -Directory -Filter 'Gyan.FFmpeg.Essentials*' | Select-Object -First 1
}
if (-not $package) { throw 'Pacote FFmpeg não encontrado após a instalação.' }
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe', 'LICENSE')) {
    $source = Get-ChildItem -LiteralPath $package.FullName -Recurse -File -Filter $name | Select-Object -First 1
    if (-not $source) { throw "Arquivo ausente no pacote FFmpeg: $name" }
    Copy-Item -LiteralPath $source.FullName -Destination $destination -Force
}
$version = & (Join-Path $destination 'ffmpeg.exe') -version
@("FFmpeg Essentials, Gyan builds: https://www.gyan.dev/ffmpeg/builds/", 'Source/build configuration: https://github.com/GyanD/codexffmpeg', '', $version) | Set-Content -LiteralPath (Join-Path $destination 'BUILD.txt') -Encoding utf8
Write-Host 'FFmpeg e FFprobe preparados para desenvolvimento e bundle Windows.'
