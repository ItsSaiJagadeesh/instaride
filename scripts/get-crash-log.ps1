# Collects the crash message when the InstaRide app closes by itself on your Android phone.
# Works in Windows PowerShell 5.1 and newer. Run it from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\get-crash-log.ps1
# It needs: the phone connected by USB cable, with "USB debugging" switched on (the script explains how).
# It saves a small text file (default: your Desktop) that you can send to your developer or upload to the chat.
# It reads only the phone's error log. It does not change anything on the phone.
param(
  [string]$AdbPath = "",
  [string]$Package = "in.instaride.app",
  [string]$Serial = "",
  [string]$Out = ""
)
# Windows PowerShell 5.1 turns any text a program writes to its error stream (adb prints harmless
# notices there, such as "daemon started") into a fatal error when this is 'Stop', so keep it 'Continue'.
$ErrorActionPreference = 'Continue'
$interactive = -not $env:NONINTERACTIVE
function Say($text) { Write-Host $text }
function Stop-With($text) { Write-Host ""; Write-Host $text -ForegroundColor Yellow; exit 1 }

# ---- 1. find Google's "adb" tool, or download it (it is Google's official platform-tools, about 7 MB)
$adb = $null
if ($AdbPath -and (Test-Path $AdbPath)) { $adb = $AdbPath }
if (-not $adb) { $found = Get-Command adb -ErrorAction SilentlyContinue; if ($found) { $adb = $found.Source } }
if (-not $adb) {
  $dir = Join-Path ([IO.Path]::GetTempPath()) 'instaride-platform-tools'
  $exe = Join-Path $dir 'platform-tools\adb.exe'
  if (-not (Test-Path $exe)) {
    Say "Downloading Google's Android platform-tools (one time, about 7 MB)..."
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $zip = Join-Path $dir 'platform-tools.zip'
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip -UseBasicParsing -ErrorAction Stop
      Expand-Archive -Path $zip -DestinationPath $dir -Force -ErrorAction Stop
    } catch {
      Stop-With "Could not download the tool. Download 'SDK Platform-Tools for Windows' from developer.android.com/tools/releases/platform-tools, unzip it, then run this script again with:  -AdbPath C:\path\to\platform-tools\adb.exe"
    }
  }
  $adb = $exe
}
if (-not (Test-Path $adb)) { Stop-With "adb was not found at $adb" }

# ---- 2. find the phone
& $adb start-server 2>&1 | Out-Null
# keep only the real device lines; ignore the heading and any "* daemon ..." notices
$lines = @(& $adb devices 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' -and $_ -notmatch '^(List of devices|\*)' })
if ($lines.Count -eq 0) {
  Stop-With @"
No phone found. Please:
  1. On the phone open Settings, About phone, and tap 'Build number' 7 times (it says you are now a developer).
  2. Settings, System (or Additional settings), Developer options, switch ON 'USB debugging'.
  3. Plug the phone into this computer with a USB cable. If the phone asks about the USB mode, choose 'File transfer'.
  4. When the phone asks 'Allow USB debugging?', tap Allow (tick 'Always allow').
Then run this script again.
"@
}
$ready = @($lines | Where-Object { $_ -match '\sdevice$' })
if ($lines | Where-Object { $_ -match '\sunauthorized$' }) { Stop-With "The phone is asking for permission. Look at the phone screen, tap 'Allow' on the 'Allow USB debugging?' box, then run this script again." }
if ($lines | Where-Object { $_ -match '\soffline$' }) { Stop-With "The phone shows as 'offline'. Unplug the cable, plug it in again, unlock the phone, and run this script again." }
if ($ready.Count -eq 0) { Stop-With ("Could not use the phone. The tool says: " + ($lines -join '; ')) }
if ($ready.Count -gt 1 -and -not $Serial) { Stop-With ("More than one phone is connected. Unplug the others, or run again with  -Serial <id>  using one of: " + (($ready | ForEach-Object { ($_ -split '\s+')[0] }) -join ', ')) }
if (-not $Serial) { $Serial = ($ready[0] -split '\s+')[0] }
function Adb { & $adb -s $Serial @args 2>&1 }

# ---- 3. what phone and which build is it?
function Prop($name) { (("" + (Adb shell getprop $name)) -replace "`r", '').Trim() }
$model = (Prop 'ro.product.manufacturer') + ' ' + (Prop 'ro.product.model')
$android = Prop 'ro.build.version.release'
$sdk = Prop 'ro.build.version.sdk'
$abi = Prop 'ro.product.cpu.abi'
$pkgInfo = (Adb shell dumpsys package $Package) -join "`n"
$installed = $pkgInfo -match 'versionCode='
$versionCode = ''
if ($installed) { $versionCode = ([regex]::Match($pkgInfo, 'versionCode=(\d+)')).Groups[1].Value }
Say ""
Say "Phone:        $model, Android $android (API $sdk), $abi"
if ($installed) { Say "InstaRide:    installed, build number (version code) $versionCode" } else { Say "InstaRide:    NOT installed on this phone" }
if (-not $installed) { Stop-With "The InstaRide app ($Package) is not installed on the connected phone. Install the APK first, then run this script again." }

# ---- 4. reproduce the crash while the log is recording
Adb logcat -c | Out-Null
Say ""
Say "Now, on the phone: OPEN the InstaRide app and wait until it closes by itself."
if ($interactive) { Read-Host "When it has closed, press Enter here" | Out-Null }
Start-Sleep -Seconds 2

$crash = @(Adb logcat -d -b crash -v threadtime)
$main = @(Adb logcat -d -b main -v threadtime)
$pattern = 'instaride|AndroidRuntime|FATAL|ReactNative|ReactNativeJS|SoLoader|hermes|Hermes|UnsatisfiedLink|Fatal signal|libc\s|DEBUG\s|ExpoModules|expo\.|MapsInitializer|GoogleMap|API key|worklets|reanimated'
$relevant = @($main | Where-Object { $_ -match $pattern })
if ($relevant.Count -gt 400) { $relevant = $relevant[($relevant.Count - 400)..($relevant.Count - 1)] }

if (-not $Out) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop -or -not (Test-Path $desktop)) { $desktop = (Get-Location).Path }
  $Out = Join-Path $desktop 'instaride-crash-log.txt'
}
$report = @()
$report += "InstaRide crash log"
$report += "Phone: $model, Android $android (API $sdk), $abi"
$report += "InstaRide build number (version code): $versionCode"
$report += "Collected: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
$report += ""
$report += "===== CRASH BUFFER (the phone's own record of crashes) ====="
$report += $crash
$report += ""
$report += "===== RELEVANT LINES FROM THE MAIN LOG (last 400) ====="
$report += $relevant
$report | Set-Content -Path $Out -Encoding UTF8

Say ""
Say "Saved: $Out"
$fatal = @($crash | Where-Object { $_ -match 'FATAL EXCEPTION|Fatal signal|UnsatisfiedLinkError|Caused by|Process: ' } | Select-Object -First 12)
if ($fatal.Count -gt 0) {
  Say ""
  Say "What the phone recorded (first lines):"
  $fatal | ForEach-Object { Say ("  " + $_) }
} else {
  Say ""
  Say "The crash buffer is empty. Either the app did not crash this time, or the crash happens before Android records it. The file still has the main log lines, so please send it anyway."
}
Say ""
Say "Please upload that file to the chat. It holds only error-log lines, but open it in Notepad first if you want to check what it contains."
