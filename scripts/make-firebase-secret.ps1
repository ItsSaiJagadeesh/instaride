# Turns your Firebase google-services.json into the text for the GitHub secret FIREBASE_GOOGLE_SERVICES_BASE64.
# Works in Windows PowerShell 5.1 and newer.
#   powershell -ExecutionPolicy Bypass -File scripts\make-firebase-secret.ps1
# (or add  -File "C:\path\to\google-services.json"  to name the file yourself; otherwise the newest one in Downloads is used)
# It checks the file, writes the text to your Desktop and opens it in Notepad. In Notepad press Ctrl+A, Ctrl+C, paste it into the
# GitHub secret, then DELETE the text file (the script prints the exact command).
param([string]$File = "", [string]$Out = "")
$ErrorActionPreference = 'Stop'
if (-not $File) {
  $found = Get-ChildItem "$HOME\Downloads" -Recurse -Filter "google-services*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $found) { throw "No google-services.json was found in Downloads. Download it from the Firebase console (Project settings, your Android app) first." }
  $File = $found.FullName
}
if (-not (Test-Path -LiteralPath $File)) { throw "File not found: $File" }
$item = Get-Item -LiteralPath $File
if ($item.Length -gt 20000) { throw "That file is too big to be a google-services.json ($($item.Length) bytes)." }
try { $json = Get-Content -LiteralPath $File -Raw | ConvertFrom-Json } catch { throw "That file is not a valid google-services.json (it could not be read as JSON)." }
if (-not $json.project_info.project_id) { throw "That file has no Firebase project in it. Download google-services.json again." }
$mine = @($json.client | Where-Object { $_.client_info.android_client_info.package_name -eq 'in.instaride.app' })
if ($mine.Count -lt 1) { throw "This file is not for the app in.instaride.app. In Firebase, add that Android app and download the file again." }

Write-Host "Checked: project id $($json.project_info.project_id), app in.instaride.app."
Write-Host "Reminder: Firebase keeps your signing-key fingerprints (SHA-1 and SHA-256) in Project settings, not in this file. Make sure both are added there."
if (-not $Out) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop -or -not (Test-Path $desktop)) { $desktop = (Get-Location).Path }
  $Out = Join-Path $desktop 'firebase-secret.txt'
}
$text = [Convert]::ToBase64String([IO.File]::ReadAllBytes($item.FullName))
[IO.File]::WriteAllText($Out, $text)
Write-Host "Wrote $($text.Length) characters to $Out"
Write-Host "1) In Notepad press Ctrl+A, Ctrl+C. 2) Paste into the GitHub secret FIREBASE_GOOGLE_SERVICES_BASE64."
Write-Host "3) Delete the file:  Remove-Item `"$Out`""
if (-not $env:NONINTERACTIVE) { Start-Process notepad.exe $Out }
