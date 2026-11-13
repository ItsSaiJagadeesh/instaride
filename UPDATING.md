# Updating an existing copy (Windows PowerShell)

Use this if you already have a working copy from an earlier zip. Your `.env`, `node_modules` and Redis data are kept.

1. Stop Expo and the server (Ctrl+C in each window).
2. Copy everything from the new zip's `instaride` folder over your project folder (choose **Replace**).
3. In your project folder, delete the files this version removed (they would otherwise stay behind and cause errors):
   ```powershell
   Remove-Item app\login.tsx, app\register.tsx, app\admin.tsx, app\account\password.tsx -ErrorAction SilentlyContinue
   Remove-Item app\rider.tsx -ErrorAction SilentlyContinue
   ```
4. Install the one new package: `npm install`
5. Start the server: `npm run server:dev`. In development with no SMS provider, **sign-in codes are printed in the server window**
   (look for `[SMS to +91…] 123456 is your InstaRide verification code`). Type that code into the app.
6. Start the app: `npm run app:dev`, then scan the QR code in Expo Go.

Existing test accounts keep working: they have no password any more and sign in with a code. If anything
looks wrong with old test data you can wipe it: `docker exec instaride-redis redis-cli FLUSHALL`, then restart the server
(this also resets the Super Admin, which is created again from `.env` on the next start).

## Update that adds the server pack, the one-click build and the Go-live meter

New files and folders: `Dockerfile`, `.dockerignore`, `deploy/`, `.github/`, `GO_LIVE.md`, `scripts/make-upload-key.*`. Nothing was removed and no new
npm package is needed. Copy the new files over your folder, then restart the server. Open the console: there is a new **Go-live meter** tab.
To run behind a proxy or in Docker the server now understands `TRUST_PROXY=1`; on your laptop you do not need it.

## Update that adds Mappls (map, search and routes)

New dependency: run `npm install` once after copying the files. New files: `plugins/with-mappls.js`, `react-native.config.js`, `lib/places.ts`,
`lib/places-core.ts`, `scripts/make-mappls-secret.ps1`, `scripts/places-core-test.ts`. Nothing was removed. The driver app now follows the phone's GPS while
it is open, so riders see the driver move. Builds without the Mappls files still work and show the map placeholder.

## Update: reject a request, cancel with a reason

Drivers can now **Reject** a ride request (with a 30-second countdown; an unanswered request is rejected for that driver) and **cancel after accepting**
(the ride goes back to searching and that driver is not offered it again). Riders and drivers pick a **reason** when cancelling; the reasons are saved
and the admin can see them (`cancelLog`, `declinedBy` on a ride; riders and other drivers never see who rejected). New route: `PUT /api/rides/:id/decline`.
No data migration is needed: the new fields are optional, and existing rides keep working.

## Update: Twilio script and the ride start code

`deploy/set-twilio.sh` connects Twilio on a running server (run `sudo bash deploy/set-twilio.sh`; it asks privately, so the Auth Token is never shown or pasted anywhere else).
The ride start code is now the **last 4 digits of the rider's mobile number** (`RIDE_CODE_MODE=phone_last4`, the default). Set `RIDE_CODE_MODE=random` in `deploy/.env`
for a new random code on every ride, which is harder to guess because it changes each time. After editing `.env` run `docker compose up -d --force-recreate app`.

## Update: Firebase phone sign-in

New dependencies (`@react-native-firebase/app` and `auth`, pinned to **23.8.8**: version 27 needs a newer React Native than 0.81 and fails to compile, so do not upgrade Firebase without also upgrading Expo and React Native): run `npm install` once. New files: `server/firebase.ts`, `lib/phone-proof.ts`, `scripts/make-firebase-secret.ps1`,
`scripts/firebase-auth-test.mjs`, `deploy/set-firebase.sh`. The server now tells the app, number by number, how to prove it ("mode": "code" or "firebase"). With `FIREBASE_PROJECT_ID`
set, numbers that are not in `OTP_FIXED` prove themselves with Firebase, and the server checks Google's signed proof itself (signature, project, freshness, phone number, used once).
Apps built before this update cannot sign in those numbers ("please update the app"). Without `FIREBASE_PROJECT_ID`, nothing changes. Deleting an account is confirmed the same way.

## Update: rider contact for the driver, rider gender

The driver's active-ride screen now shows the rider's name, mobile number and pickup, with **Call** (opens the dialler) and **WhatsApp** (opens a ready-typed message; nothing is sent
automatically). The greeting follows the rider's own saved gender (Namaste Sir, Namaste Madam, or plain Namaste); riders can set it under Edit profile. The details come from
`GET /api/rides/:id/rider-contact`, which only the driver assigned to that live ride can use. It is refused for other drivers, riders, the admin console and signed-out users, and stops
working the moment the ride is cancelled, handed to another driver or finished. The number is not in the ride record or the request list. No database change is needed (gender is optional).
New files: `components/RiderContactCard.tsx`, `lib/rider-contact-core.ts`, `scripts/rider-contact-test.ts`.
