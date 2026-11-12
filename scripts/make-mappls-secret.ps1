# Turns your Mappls zip (the one with the .a.olf and .a.conf files) into the text for the GitHub secret
# MAPPLS_ANDROID_CONFIG_ZIP_BASE64. Works in Windows PowerShell 5.1 and newer.
#   powershell -ExecutionPolicy Bypass -File scripts\make-mappls-secret.ps1 -Zip "C:\path\to\your-mappls.zip"
# It writes the text to a file on your Desktop and opens it in Notepad. In Notepad press Ctrl+A, then Ctrl+C,
# paste it into the GitHub secret, then DELETE the file (the script prints the exact command).
# The zip is checked first: it must contain exactly one .a.olf and one .a.conf with the same name.
param([Parameter(Mandatory = $true)][string]$Zip, [string]$Out = "")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not (Test-Path -LiteralPath $Zip)) { throw "Zip not found: $Zip" }
$a = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Zip).Path)
try {
  $olf = @($a.Entries | Where-Object { $_.Name -like '*.a.olf' })
  $conf = @($a.Entries | Where-Object { $_.Name -like '*.a.conf' })
} finally { $a.Dispose() }
if ($olf.Count -ne 1 -or $conf.Count -ne 1) { throw "The zip must contain exactly one .a.olf and one .a.conf file (found $($olf.Count) and $($conf.Count)). Download the Android files from the Mappls console as a ZIP." }
if ($olf[0].Name -replace '\.a\.olf$', '' -ne ($conf[0].Name -replace '\.a\.conf$', '')) { throw "The two files do not belong together (different names)." }

if (-not $Out) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop -or -not (Test-Path $desktop)) { $desktop = (Get-Location).Path }
  $Out = Join-Path $desktop 'mappls-secret.txt'
}
$text = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Zip).Path))
[IO.File]::WriteAllText($Out, $text)
Write-Host "Checked: the zip holds $($olf[0].Name) and $($conf[0].Name)."
Write-Host "Wrote $($text.Length) characters to $Out"
Write-Host "1) In Notepad press Ctrl+A, Ctrl+C. 2) Paste into the GitHub secret MAPPLS_ANDROID_CONFIG_ZIP_BASE64."
Write-Host "3) Delete the file:  Remove-Item `"$Out`""
if (-not $env:NONINTERACTIVE) { Start-Process notepad.exe $Out }
