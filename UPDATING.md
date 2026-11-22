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

## Update: fixed sign-in codes are now an explicit choice in production; final WhatsApp wording; pickup on the contact card

- **Fixed codes (`OTP_FIXED`) are ignored in production unless `ALLOW_FIXED_OTP=yes` is set.** Turn them on or off with `sudo bash deploy/set-fixed-otp.sh on | off | clear`
  (`clear` also empties the list). The server prints one security line at start-up saying how many numbers are involved, never the numbers or the codes. Development is unchanged.
  After updating a server that already uses fixed codes, run `set-fixed-otp.sh on` straight away, or those numbers stop working. Switch them off before the public launch.
- The WhatsApp message is now: "Namaste [Sir/Madam], I am your InstaDriver. I am contacting you regarding your InstaRide pickup." (plain "Namaste" when gender is other or unset).
- The driver's contact card now also shows the pickup location.
- Real text messages from Firebase need billing enabled on the Firebase project (the app reports `auth/billing-not-enabled` without it).
New files: `deploy/set-fixed-otp.sh`, `scripts/fixed-otp-guard-test.mjs`.

## Update: destination search card no longer runs off the top of the screen

The "Set your destination" card is now held in a frame that starts just under the header and ends on the keyboard. The title and the search box stay fixed at the top of the card, the suggestions
(at most 6) sit directly below the box, and the suggestions, recent places and buttons scroll inside the card. Before, many suggestions made the card taller than the screen, so its top (the
title and the search box) went off the top edge and the list covered the header. App change only: no server update is needed. `scripts/mock-geocoder.mjs` (tests only) now returns 8 results for
a search containing "market", to reproduce this.

## Update: peer reviews of drivers (tags and a written review the driver can read)

- After a trip the rider can still give 1 to 5 stars. New: pick quick tags (Polite, On time, Safe driving, Clean vehicle, Knew the route, Helpful) and write a short review (up to 300 characters).
  The driver can read the tags and the review **without the rider's name**. The old private note to the admins is kept (behind "Add a private note for the InstaRide team") and drivers never see it.
- The driver has a new **My reviews** screen (Settings, then My reviews): the average, how often each tag was chosen, and the written reviews. It shows only the date, never the rider's name, number or the trip.
  Server: `GET /api/driver/reviews` (drivers only).
- An admin can hide a written review from the driver (the stars and tags still count) from the console: Rides, then the star button on a trip, then "Hide from driver".
  Server: `PUT /api/admin/rides/:id/review/hide` (admins only).
- Needs a **server update** (new routes) and a new app build. No database change: the new fields are optional and old reviews keep working.
- The "Ride Complete" card is now held in the same frame as the destination card, so it can never run under the header on a small phone.

## Update: payment page with a UPI QR code, driver reviews of riders, anonymous reviews both ways

**Payment page.** When the driver taps Complete Ride, both phones show a payment page instead of going straight on.
- The **driver** sees the fare, a **QR code** (a upi:// link holding the driver's UPI ID and the exact fare, so the rider scans it with any UPI app and types nothing),
  and two buttons: **Collected in cash** and **Collected by UPI** (with an "are you sure" question). A driver without a UPI ID is asked for one right there.
- The **rider** sees the fare, **Pay with a UPI app** (opens their own UPI app with everything filled in), a note that the driver's QR can be scanned instead, and **I have paid**
  (it only tells the driver; the driver still confirms).
- InstaRide never holds the money, and UPI cannot tell us when a payment arrives, so the **driver's confirmation** ends the payment step. Then the reviews open.
- A driver's UPI ID is set in Edit profile (drivers only). It is only ever sent to the rider and driver of that trip, as part of the payment link, and never appears in ride records or lists.
- Server: `GET /api/rides/:id/payment`, `PUT /api/rides/:id/payment/collect`, `PUT /api/rides/:id/payment/claim`. The driver's screen keeps an unpaid finished trip until it is collected, even after the app is closed.
- Trips finished before this update have no payment record and count as paid, so their reviews keep working.

**Reviews both ways, anonymous.** After the payment the rider reviews the driver (as before) and the **driver now reviews the rider** (stars, tags, a written review, an optional private note to admins).
Each side reads what the other said about them under Settings, then My reviews, **without names**: the lists show only the month, the stars, the tags and the written review. A trip record no longer
carries the review written about you (the author keeps their own copy), so nobody can match a review to a trip. Admins can hide either written review (Rides, then the trip, then Hide).
Server: `PUT /api/rides/:id/rider-review`, `GET /api/rider/reviews`; the earlier `/api/driver/reviews` now shows the month instead of the date.

Needs a **server update** and a new app build. Run `npm install` once (new package `qrcode-generator`, pure JavaScript). No database change: all new fields are optional.
New files: `server/payments.ts`, `components/UpiQr.tsx`, `components/DriverPaymentCard.tsx`, `components/RiderPaymentCard.tsx`, `components/TripReviewForm.tsx`, `scripts/payments-test.ts`.
