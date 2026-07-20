$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$venvDir = Join-Path $projectRoot ".venv-win"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m venv $venvDir
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -m venv $venvDir
  } else {
    throw "python was not found in PATH."
  }
}

$pythonCmd = $venvPython
$pythonBaseArgs = @()

& $pythonCmd @pythonBaseArgs -m pip install --upgrade pip
& $pythonCmd @pythonBaseArgs -m pip install -r requirements-windows.txt

if (Test-Path ".\local-platform-worker.exe") {
  Remove-Item ".\local-platform-worker.exe" -Force
}

& $pythonCmd @pythonBaseArgs -m PyInstaller --onefile --name local-platform-worker --distpath . workers\local_platform_worker\worker_entry.py

Write-Host "Windows local platform worker build complete."
