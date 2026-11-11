# InstaRide

A local ride-hailing platform for one town. **One Android/iOS app** with two roles, and a web console for you:

| Piece | What it is | Who uses it |
| --- | --- | --- |
| **InstaRide app** | One app (Expo / React Native). On the welcome screen people choose **Rider** or **Driver**, then **Create account** or **Sign in**. | Riders who book, drivers who drive |
| **Super Admin web console** | A website served by the backend at `/console` | You and staff you trust |

There are no passwords for riders and drivers: they sign in with a **6-digit code sent to their mobile number**.
The same number can have one rider account and one driver account. The console (Super Admin) signs in with a phone number and password.

Drivers pay a flat fee per completed ride (default ₹5), not a commission. Every driver and vehicle is checked by hand first.
See **PLAY_STORE.md** for building the Android file and publishing, **GO_LIVE.md** for the whole path from working code to real users (server pack, one-click Android build, and the in-console Go-live meter), and **DEMO.md** for a server-free demo version (sign in with 9182631581 and code 123456) that you can build into an APK and show to anyone.

> InstaRide is a fork of RideFlow and is licensed **GPL-3.0-or-later**. See `NOTICE.md` and `LICENSE`.
> If you distribute the apps (for example on the Play Store) you must make the full source, including
> your changes, available under the same licence.

## Status: prototype

Tested: the API (141 checks, including sign-in codes, expiry, wrong tries and cooldowns), the SMS sender against a fake
of Twilio (15 checks), the Super Admin console (34 UI checks) and the app in a real desktop browser (15 end-to-end checks:
both sign-ups, both sign-ins, booking, driver accept, share trip, SOS, history, safety, deletion). The code is type-checked
and the Android project generates with the right permissions.

**Not tested:** the app on a real phone (camera, GPS, share sheet, SMS compose), real SMS delivery, the real
OpenStreetMap search, load, and independent security review. No APK or Play Store file has been built (that needs your
Expo account). Do not take real riders, documents or money through it until a developer has reviewed it and you have done a
field test. Read "Before going live" below and PLAY_STORE.md.

## Roles

| Role | Where | Can do |
| --- | --- | --- |
| **Rider** | InstaRide app | Sign up or sign in with a code, pick Bike/Auto/etc., see a fare in ₹ before booking, get a 4-digit start code, track the driver, cancel before the trip starts, rate the driver. Pays the driver in cash. |
| **Driver** | InstaRide app | Sign up or sign in with a code, upload 9 photos (4 sides, number plate, RC, licence, insurance, selfie with vehicle number), wait for approval, go online, accept rides, enter the rider's start code, complete rides, see earnings and fees due. |
| **Super Admin** | Web console (`/console`) | Review and approve/reject drivers (VAHAN checklist, expiry dates), see all rides and people, search, suspend/remove users, cancel rides, record fee payments, edit fares, fee, vehicle types and service area, handle SOS alerts, read the audit log. Signs in with a password. |

One mobile number can have a rider account **and** a driver account; they are separate. The phone app has no admin screen at all.
You can still build a rider-only or driver-only app with `APP_VARIANT` (see `app.config.js`), but the default and the one to publish is the single app.

## What is in the apps

**InstaRider app** (bottom tabs: Home, My rides, Profile)
- Home: map, "Where to?", address search (press search; results come from our server), tap-on-map, saved and recent places as one-tap chips, fare for each vehicle type, 4-digit start code, driver card, **Share trip** and **SOS** during a ride, cancel before the trip starts, rate the driver.
- My rides: history with status, date and fare; tap a ride for the fare breakdown and vehicle number.
- Profile: Favourite places, Safety (emergency contact, tips, call 112), Notifications, Payment (cash for now), Help (FAQ + support contact), Settings (edit profile, change password, log out, delete account), About (privacy policy, terms, open-source licence).

**InstaDriver app:** verification, go online, rides with the start code, earnings and fee ledger, insurance renewal, **SOS** during a ride, and the same account pages (My rides, Notifications, Safety, Help, Settings) from the account menu.

**Super Admin console** also shows **SOS alerts** (with rider and driver phone numbers and a "handled" button) and has fields for the support phone, support email and source-code link.

**Trip sharing:** the link opens a public page at `/track/<code>` showing status, route, driver first name, vehicle number and the driver's live position. No phone numbers. It stops working one hour after the trip ends.

**Privacy policy and terms:** served at `/legal/privacy` and `/legal/terms` from the `legal/` folder. They are **draft templates** with `[PLACEHOLDERS]`: fill them in and have a lawyer review them before you publish the apps.

**Address search:** the free OpenStreetMap service forbids search-as-you-type and requires a contact in the request, so the server does the lookups, caches them, and sends at most one request per second. Set `GEOCODER_CONTACT` in `.env`. It is fine for a pilot; for real volume use your own Nominatim or a paid places service.

## How driver verification works

1. Driver signs up with phone, password, vehicle type and number.
2. Driver takes 9 photos in the app and submits them.
3. In the **web console → Verification** you see the photos side by side (click a photo to enlarge), look
   the vehicle number up on VAHAN (link opens the site), tick the box, enter insurance and fitness expiry
   dates (DD/MM/YYYY) and approve. Or ask for specific photos again, or reject with a reason.
4. Only approved drivers can go online. When insurance or fitness expires the driver is blocked until a
   new insurance photo is uploaded and approved. Only yellow plates should be approved; the app cannot
   tell plate colour, so this is a manual check.

## Run it locally

Needs Node 20.12 or newer (v20.20 and v22 are fine), Docker Desktop (for Redis), and Expo Go on an Android
phone. These steps work in Windows PowerShell, Mac and Linux.

```bash
npm install

# 1. Settings file. Windows PowerShell: Copy-Item .env.example .env   (Mac/Linux: cp .env.example .env)
#    Then open .env in Notepad and set EXPO_PUBLIC_DOMAIN to your computer's Wi-Fi address (see below).
#    Leave ADMIN_PASSWORD empty for a first try: a random one is printed once when the server first starts.

# 2. Redis (needs Docker Desktop to be running)
docker run -d --name instaride-redis -p 127.0.0.1:6379:6379 -v instaride-redis:/data redis:7 redis-server --appendonly yes

# 3. Backend: reads .env by itself. SAVE the Super Admin phone/password it prints on the very first start.
npm run server:dev

# 4. Super Admin web console: open http://localhost:5000/console/ and sign in.

# 5. The phone app (phone and computer on the same Wi-Fi). Scan the QR code in Expo Go.
npm run app:dev
```

**Signing in during development:** with no SMS provider set, the sign-in code is **printed in the server window**
(`[SMS to +91…] 123456 is your InstaRide verification code…`). Type it into the app. No real SMS is sent.

**Your computer's Wi-Fi address:** Windows: run `ipconfig` and read "IPv4 Address" under your Wi-Fi adapter
(something like `192.168.1.20`). Mac: `ipconfig getifaddr en0`. Then in `.env` write
`EXPO_PUBLIC_DOMAIN=192.168.1.20:5000`. If Windows asks whether to allow Node.js through the firewall,
allow it on private networks, otherwise the phone cannot connect.

To start Redis again after a reboot: `docker start instaride-redis` (your data is kept in a Docker volume).

Driver photo capture, camera and GPS need a real phone (Expo Go works for testing). The web console works
in any desktop browser. Do not expose the console over plain http outside your own computer: use https.

## Building the Android app

Easiest: GitHub builds it for you with one click (see **GO_LIVE.md**, step 6). Or with Expo's cloud build:

See **PLAY_STORE.md** for the full guide. In short, with a free Expo account and your https server address in `eas.json`:

```bash
npx eas-cli login
npx eas-cli build --platform android --profile app-preview      # APK to test on a phone
npx eas-cli build --platform android --profile app-production   # .aab to upload to Google Play
```

The production build refuses to run if the server address is a placeholder or a local address, or if plain http is on.
The app asks for location and (for drivers) the camera, and removes microphone, storage and "draw over apps" permissions.
The package ID `in.instaride.app` cannot be changed after the first Play Store upload: change it in `app.json` first if you want another.

## Sign-in codes (OTP)

A code is 6 digits, valid 5 minutes, used once, with 5 wrong tries allowed. A phone can ask for a new code every 30 seconds and at most
5 times an hour. Codes are stored only as a hash. Settings (all in `.env`): `SMS_PROVIDER`, `TWILIO_*`, `OTP_FIXED` (demo numbers for
Google's reviewers), and `OTP_TEST_CODE` (testing only; the server refuses to start with it in production). Delivery by SMS needs an SMS provider with
India DLT registration; Twilio is built in and other providers can be added in `server/sms.ts`. Android automatic code reading is not built:
people type the 6 digits.

## Tests

Use a throwaway Redis and server. For the API suite start the server with `OTP_TEST_CODE=123456 OTP_TTL_SECONDS=4 OTP_RESEND_SECONDS=2
OTP_IP_LIMIT_PER_HOUR=1000 OTP_MAX_SENDS_PER_HOUR=4` (short timers so the expiry and cooldown tests are quick), then:

```bash
# set BASE, ADMIN_PHONE and ADMIN_PASSWORD in your terminal first (Linux/Mac: export NAME=value;
# PowerShell: $env:NAME="value"), BASE being http://localhost:5000
npm run test:api        # backend: sign-in codes, permissions, uploads, verification, rides, fees, account, SOS, sharing
JSDOM_PATH=/path/to/node_modules/jsdom npm run test:console   # web console UI in a simulated browser
npm run test:sms        # sending codes through a fake Twilio (see the header of scripts/sms-provider-test.mjs)
```

`test:console` needs `jsdom` installed somewhere (`npm install jsdom` in a scratch folder). **Never run any suite against a database that
holds real data**: they create test users and change settings.

## Fares and fee

Set in **Super Admin → settings**: per-vehicle base fare, per-km, per-minute and minimum fare in ₹;
the flat fee per ride; the unpaid-dues limit; surge (capped at 2x); and the service area circle.
Defaults are placeholders, and the default service-area centre for Jangareddygudem is approximate: check
it on a map. Fares use straight-line distance times a road factor, not real road routing, and the fare
shown is the fare charged (no GPS metering yet).

## Before going live

- [ ] A developer reviews the code and a third party tests security
- [ ] Put the server behind HTTPS; set `SESSION_SECRET`, `ADMIN_PHONE`, `ADMIN_PASSWORD`
- [ ] Redis with persistence and backups; back up the `UPLOADS_DIR` folder; encrypt the disk
- [ ] Privacy policy and consent screen (driver ID documents are personal data)
- [ ] Check with the Andhra Pradesh transport department / local RTO that yellow-plate bike taxis and
      your aggregator model are permitted; get a lawyer's view on licensing and insurance
- [ ] Fill in and legally review the privacy policy and terms in `legal/`, and set the support contact in the console
- [ ] Set up an SMS provider with DLT registration and test real code delivery; changing the mobile number is not built
- [ ] Staff must watch the console's SOS alerts during service hours: nothing sends SMS or phone alerts by itself
- [ ] Add real payments if wanted (rides are cash only today)
- [ ] Android release build with background location if you want tracking while the screen is off (not built)
- [ ] Confirm the VAHAN link in `admin-web/app.js` is current
- [ ] Put the console behind https and, if you can, restrict `/console` to known IP addresses
- [ ] The old in-app admin screen (`app/admin.tsx`) only runs in the development build; delete it if you do not need it

## Project layout

```
admin-web/      Super Admin web console (plain HTML/CSS/JS, served at /console)
app/            Expo Router screens (welcome, login, register, rider, driver, admin)
app.config.js   Builds the app (single InstaRide app by default) and runs build safety checks
eas.json        Android build profiles
components/     Shared UI + DriverVerification
lib/            API client, auth context, token store, formatting, photo upload
server/         Express API (routes, auth, fare, storage)
shared/         Types and validation shared by app and server
scripts/        API, SMS-provider and web console UI tests, fake services
```

## Licence

GNU General Public License v3.0 or later. See `LICENSE` and `NOTICE.md`.
