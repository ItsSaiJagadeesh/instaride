# Demo version

The demo runs **entirely inside the app**. It needs no server and no internet, so you can hand it to anyone to look at.

- Sign in as **Rider** or **Driver** with **9182631581** and the code **123456**. Nothing else works.
- You can open every screen: Home, fares, history, profile, safety, help (and, as a driver, the dashboard, going online and a sample ride request).
- **Switched off:** booking, accepting a ride, sign-up, deleting the account. The app says so in plain words.
- On a phone the demo shows a labelled placeholder where the map would be (the real map needs a Google Maps key). Everything else works.
- All data is sample data and is reset when the app is closed.
- It is for showing the app. It is **not** the build for Google Play and it contains no real accounts.

## Build the demo APK (free Expo account, about 15 to 30 minutes)

```powershell
npx eas-cli login
npx eas-cli build --platform android --profile demo-preview          # ONE app with both roles (recommended)
# optional, two separate apps with their own icons/names:
npx eas-cli build --platform android --profile demo-rider-preview    # InstaRider only
npx eas-cli build --platform android --profile demo-driver-preview   # InstaDriver only
```

When a build finishes, Expo gives you a download link and a QR code. Open it on the phone, download the `.apk`, and allow
"install unknown apps" for your browser when Android asks. The demo needs no server address in `eas.json`.

## Run the demo on your computer without a server

```powershell
$env:EXPO_PUBLIC_DEMO="1"
npx expo start --clear
```
Scan the QR code with Expo Go (the matching SDK 54 version). Use `--clear` whenever you switch between demo and the real app.
