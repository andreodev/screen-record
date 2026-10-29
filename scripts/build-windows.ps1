param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($env:OS -ne 'Windows_NT') { throw 'Execute este script no Windows.' }

Push-Location -LiteralPath $projectRoot
try {
    $ffmpegRoot = Join-Path $projectRoot 'src-tauri/resources/ffmpeg'
    $missing = @('ffmpeg.exe', 'ffprobe.exe', 'LICENSE', 'BUILD.txt') | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $ffmpegRoot $_))
    }
    if ($missing) { & (Join-Path $PSScriptRoot 'setup-windows.ps1') }

    pnpm tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o instalador Windows.' }

    $version = (Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).version
    $installer = Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle/nsis' -File |
        Where-Object { $_.Name -like "*_${version}_x64-setup.exe" } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw "Instalador x64 da versão $version não encontrado." }

    $output = Join-Path $projectRoot 'artifacts/windows'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $destination = Join-Path $output 'Frame-Studio-Setup.exe'
    Copy-Item -LiteralPath $installer.FullName -Destination $destination -Force
    $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'), "$hash  Frame-Studio-Setup.exe`n")
    Write-Host "Instalador: $destination"
    Write-Host "SHA256: $hash"
}
finally { Pop-Location }
