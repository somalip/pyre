# pyre Windows PowerShell installer
# Usage: iwr -useb https://raw.githubusercontent.com/somalip/pyre/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'

Write-Host "🔥 Installing pyre system monitor for Windows..." -ForegroundColor Cyan

# Check for Node.js / npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "✖ Node.js and npm are required to run pyre." -ForegroundColor Red
    Write-Host "  Please install Node.js (>= 18) from https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

Write-Host "📦 Installing pyre-cli globally via npm..." -ForegroundColor Green
try {
    npm install -g pyre-cli
} catch {
    Write-Host "✖ Failed to install pyre-cli globally." -ForegroundColor Red
    exit 1
}

if (Get-Command pyre -ErrorAction SilentlyContinue) {
    Write-Host "✔ pyre installed successfully!" -ForegroundColor Green
    Write-Host "  Run 'pyre live' to start the interactive dashboard." -ForegroundColor Cyan
    Write-Host "  Run 'pyre --help' to see all available commands." -ForegroundColor Cyan
} else {
    Write-Host "ℹ Installation complete. If 'pyre' command is not recognized, restart your PowerShell session." -ForegroundColor Yellow
}
