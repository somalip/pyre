# pyre Windows PowerShell installer
# Usage: irm https://raw.githubusercontent.com/somalip/pyre/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'

# In PowerShell 7.3+, prevent non-terminating native stderr output (like npm notices) from aborting the script
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

Write-Host "🔥 Installing pyre system monitor for Windows..." -ForegroundColor Cyan

# Check for Node.js / npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "✖ Node.js and npm are required to run pyre." -ForegroundColor Red
    Write-Host "  Please install Node.js (>= 18) from https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

# Ensure execution policy allows running npm scripts (like pyre.ps1) for the current user
try {
    $policy = Get-ExecutionPolicy -Scope CurrentUser
    if ($policy -eq 'Undefined' -or $policy -eq 'Restricted') {
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction SilentlyContinue
    }
} catch {
    # Non-fatal; continue
}

Write-Host "📦 Installing pyre-cli globally via npm..." -ForegroundColor Green

& npm install -g pyre-cli
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Global install of 'pyre-cli' from npm registry encountered an issue. Attempting repository fallback..." -ForegroundColor Yellow
    & npm install -g somalip/pyre
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✖ Failed to install pyre globally via npm." -ForegroundColor Red
        Write-Host "  If this is a permission error (EPERM), please run PowerShell as Administrator or configure npm prefix." -ForegroundColor Yellow
        exit 1
    }
}

# Resolve global npm prefix and add to current session PATH if not already present
try {
    $npmPrefix = (npm config get prefix 2>$null)
    if ($npmPrefix) {
        $npmPrefix = $npmPrefix.Trim()
        if (-not ($env:PATH -split ';' -contains $npmPrefix)) {
            $env:PATH = "$npmPrefix;$env:PATH"
        }
        # Also ensure User PATH environment variable contains npmPrefix for future sessions
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath -and -not ($userPath -split ';' -contains $npmPrefix)) {
            [Environment]::SetEnvironmentVariable('Path', "$userPath;$npmPrefix", 'User')
        }
    }
} catch {
    # Non-fatal PATH resolution
}

if (Get-Command pyre -ErrorAction SilentlyContinue) {
    Write-Host "✔ pyre installed successfully!" -ForegroundColor Green
    Write-Host "  Run 'pyre live' to start the interactive dashboard." -ForegroundColor Cyan
    Write-Host "  Run 'pyre --help' to see all available commands." -ForegroundColor Cyan
} else {
    Write-Host "ℹ Installation complete. If 'pyre' command is not recognized in this session, please restart your PowerShell session." -ForegroundColor Yellow
}
