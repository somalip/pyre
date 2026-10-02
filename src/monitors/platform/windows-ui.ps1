<#
.SYNOPSIS
Launches a native Pyre UI window on Windows using WPF WebBrowser control.
#>
param(
    [Parameter(Mandatory=$true)]
    [int]$Port
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationFramework

$regPath = "HKCU:\Software\Microsoft\Internet Explorer\Main\FeatureControl\FEATURE_BROWSER_EMULATION"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
$scriptName = [System.IO.Path]::GetFileName($PSCommandPath)
Set-ItemProperty -Path $regPath -Name $scriptName -Value 11001 -Type DWord -ErrorAction SilentlyContinue

$form = New-Object System.Windows.Forms.Form
$form.Text = "Pyre Live Dashboard"
$form.Width = 1200
$form.Height = 800
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(860, 600)
$form.BackColor = [System.Drawing.Color]::FromArgb(10, 10, 15)
$form.ForeColor = [System.Drawing.Color]::FromArgb(245, 245, 247)

$browser = New-Object System.Windows.Forms.WebBrowser
$browser.Dock = "Fill"
$browser.ScriptErrorsSuppressed = $true
$browser.Navigate("http://localhost:$Port/")
$form.Controls.Add($browser)

$form.Add_Shown({
    $form.Activate()
})

$form.ShowDialog()
