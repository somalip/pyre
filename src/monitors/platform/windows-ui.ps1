<#
.SYNOPSIS
Launches a native standalone Pyre UI window on Windows.
Prefers Microsoft Edge or Chromium in standalone desktop application mode (--app)
for modern HTML5/ES6/Chart.js rendering without browser tabs or address bars.
#>
param(
    [Parameter(Mandatory=$true)]
    [int]$Port
)

$ErrorActionPreference = 'SilentlyContinue'

$url = "http://localhost:$Port/"

# 1. Search for Edge or Chrome executable paths
$browsers = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
)

$targetBrowser = $null
foreach ($b in $browsers) {
    if (Test-Path $b) {
        $targetBrowser = $b
        break
    }
}

if ($targetBrowser) {
    # Launch in standalone application window mode (frameless app window)
    $args = "--app=$url --window-size=1200,800"
    $proc = Start-Process -FilePath $targetBrowser -ArgumentList $args -PassThru -Wait
    exit 0
}

# 2. Fallback: Launch default system browser
Start-Process $url
exit 0
