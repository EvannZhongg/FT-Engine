$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "Starting Windows backend build..."

if (Get-Command py -ErrorAction SilentlyContinue) {
  $pythonCmd = "py"
  $pythonBaseArgs = @("-3")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $pythonCmd = "python"
  $pythonBaseArgs = @()
} else {
  throw "python was not found in PATH."
}

& $pythonCmd @pythonBaseArgs -m pip install --upgrade pip
& $pythonCmd @pythonBaseArgs -m pip install -r requirements.txt

if (Test-Path ".\backend-engine.exe") {
  Remove-Item ".\backend-engine.exe" -Force
}

& $pythonCmd @pythonBaseArgs -m PyInstaller --onefile --name backend-engine --distpath . server.py

Write-Host "Windows backend build complete."
