# Creates the key that signs your Android app, ONCE, and prepares the four GitHub secrets.
# Works in Windows PowerShell 5.1 and newer. Needs Java's keytool (install a JDK, for example Temurin 17).
#   powershell -ExecutionPolicy Bypass -File scripts\make-upload-key.ps1
# Output in the current folder:
#   instaride-upload.jks   THE KEY. Keep a copy somewhere safe and private. If you lose it you cannot update your app.
#   github-secrets.txt     the four values to paste into GitHub, then DELETE this file.
# Nothing secret is printed on screen.
$ErrorActionPreference = 'Stop'

$keytool = Get-Command keytool -ErrorAction SilentlyContinue
if (-not $keytool) { throw "keytool was not found. Install a JDK (for example Temurin 17) and try again." }

$keystore = if ($env:KEYSTORE) { $env:KEYSTORE } else { 'instaride-upload.jks' }
$secrets  = if ($env:SECRETS)  { $env:SECRETS }  else { 'github-secrets.txt' }
$alias    = if ($env:KEY_ALIAS) { $env:KEY_ALIAS } else { 'instaride' }
if (Test-Path $keystore) { throw "$keystore already exists. Refusing to overwrite your key. Move it away first if you really want a new one." }

# 24 random letters and digits
$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$pass = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '').Substring(0, 24)

# Windows PowerShell 5.1 turns any text a program writes to its error stream into a fatal error while
# ErrorActionPreference is 'Stop'. keytool prints harmless notices there, so relax it for this one call.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& keytool -genkeypair -keystore $keystore -alias $alias -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass $pass -keypass $pass -dname "CN=InstaRide, O=InstaRide" 2>&1 | Out-Null
$keytoolExit = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($keytoolExit -ne 0 -or -not (Test-Path $keystore)) { throw "keytool could not create the key." }

$b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($keystore))
$lines = @(
  'Paste each value into GitHub: your repository, Settings, Secrets and variables, Actions, New repository secret.',
  '',
  'Name:  ANDROID_KEYSTORE_BASE64', "Value: $b64", '',
  'Name:  ANDROID_KEYSTORE_PASSWORD', "Value: $pass", '',
  'Name:  ANDROID_KEY_ALIAS', "Value: $alias", '',
  'Name:  ANDROID_KEY_PASSWORD', "Value: $pass"
)
[System.IO.File]::WriteAllLines((Join-Path (Get-Location) $secrets), $lines)

Write-Host "Created $keystore (your signing key) and $secrets (the four GitHub secrets)."
Write-Host "1) Paste the four values into GitHub as repository secrets, then delete $secrets."
Write-Host "2) Keep $keystore and its password in a safe private place (a password manager or an encrypted drive). NEVER put it in the repository."
Write-Host "3) With Google Play App Signing, Google holds the final key, but you still need this upload key for every update."
