# Publishing InstaRide on Google Play

InstaRide is **one Android app** with two roles. People choose Rider or Driver when they sign up or sign in,
and use a code sent to their mobile number (no password). This file lists what you have to do. Anything marked
**CHECK** is a rule that Google or the law can change: confirm it in the Play Console or with a lawyer.

## 0. What cannot be skipped

| You need | Why |
| --- | --- |
| A server on the internet with **https** (for example `api.yourdomain.in`) | Installed Android apps refuse plain http. A build pointing at a laptop address is blocked by `eas.json`/`app.config.js`. |
| An **SMS provider** with India DLT registration | Riders and drivers cannot sign in without a code. Set it up in `.env` (see below). |
| A **Google Play Console** developer account | One-time registration fee, identity verification. **CHECK** the current fee and verification time. |
| An **Expo account** (free) | Builds the Android file in the cloud: `npx eas-cli login`. |
| Reviewed **privacy policy and terms** at public https links | Required by Google. Drafts are in `legal/`: fill in the `[PLACEHOLDERS]` and have a lawyer review them. |
| Transport licensing answers (RTO, aggregator rules, insurance) | These can stop the business even if the app is accepted. |

## 1. Prepare the server

1. Deploy the backend with https. In `.env` set `SESSION_SECRET`, `ADMIN_PHONE`, `ADMIN_PASSWORD` (12+ characters), `REDIS_URL`.
2. **SMS:** set `SMS_PROVIDER=twilio` and the three `TWILIO_*` values (or ask for another provider to be added).
   In India the message must match a **DLT-registered template**. The text sent is exactly:
   `123456 is your InstaRide verification code. It is valid for 5 minutes. Do not share it with anyone.`
3. **Reviewer accounts:** Google's reviewers cannot receive your SMS. Make two demo numbers that hold no real data and set
   `OTP_FIXED=9876500001:123456,9876500002:123456` (use your own numbers and codes). Sign in once as a rider with the first and
   as a driver with the second. For the driver, upload the 9 photos in the app and **approve it in the web console**, so the reviewer
   sees the full driver screens.
4. Fill the support phone, support email and source-code link in the console (Settings, Help and legal).
5. Check these pages open on your domain: `/legal/privacy`, `/legal/terms`, `/legal/delete-account`, `/console/`.

## 2. Build the Android files

**Option A (no Expo account): GitHub builds it.** See GO_LIVE.md, steps 6 and 7: run the *Build Android app* workflow with `kind = live`, your server address, and **play_bundle** ticked. Download `instaride.aab` from the run.

**Option B: Expo's cloud build (two commands)**

Open `eas.json` and replace `REPLACE_WITH_YOUR_API_HOST` with your server address **without** `https://`
(for example `api.yourdomain.in`), in both `app-preview` and `app-production`.

```powershell
npx eas-cli login
# A test file you can install on a phone (works with a server on your own Wi-Fi too):
npx eas-cli build --platform android --profile app-preview
# The file you upload to Google Play (.aab). Needs your https server address:
npx eas-cli build --platform android --profile app-production
```

- On the first build, let EAS create and store the **signing key**. Do not lose access to your Expo account.
- The build link downloads the `.apk` (test) or `.aab` (Play). The build refuses to run if the address is still a placeholder
  or a local address, or if plain http is switched on for a production build.
- The app's identity is `in.instaride.app`. **This cannot be changed after the first upload to Google Play.** Change `android.package`
  in `app.json` first if you want a different one.

## 3. Play Console (what Google asks)

- **Store listing:** name, short and long description, icon (512×512), feature graphic, at least 2 phone screenshots.
- **App access:** choose "all or some functionality is restricted" and give the two demo numbers and codes from step 1.3,
  with a line such as: *"Choose Create account or Sign in as rider (or driver), enter the number, then the code. No password."*
- **Privacy policy URL:** `https://YOUR-DOMAIN/legal/privacy`.
- **Account deletion:** the app has in-app deletion (Profile, Settings, Delete account). Give `https://YOUR-DOMAIN/legal/delete-account` as the web link.
- **Data safety form** (answer what the app really does; confirm with the final privacy policy):

  | Data | Collected | Why | Shared |
  | --- | --- | --- | --- |
  | Phone number, name | Yes | Account and sign-in | No (not sold; visible to our admins) |
  | Precise location | Yes, while the app is in use | Matching rides, tracking, safety | Driver's live position is shown to the rider during a trip, and to anyone the rider shares a trip link with |
  | Photos (driver documents and vehicle) | Yes, drivers only | Checking drivers are eligible | No |
  | Trip history | Yes | Fares, support, safety | No |
  | Data in transit | Encrypted | | |
  | Users can request deletion | Yes | In app and by email | |

- **Permissions:** location (foreground only; the app does not track in the background), camera (drivers photograph documents).
  The build removes microphone, storage and "draw over other apps" permissions on purpose.
- **Content rating, target audience (18+), ads (none)** questionnaires.
- **Testing before production, CHECK:** new personal developer accounts have had to run a **closed test with a minimum number of
  testers for a minimum number of days** before applying for production. Organisation accounts have been exempt. Read the current rule in the Console.

## 4. Before real riders and drivers

- Real phones tested end to end: sign-up, camera upload, GPS, booking, share trip, SOS, deletion.
- Someone watches the console's **SOS alerts** during service hours: nothing calls or texts anyone automatically.
- RTO / aggregator licensing and insurance answered in writing; terms and policy reviewed.
- A developer has reviewed the code and someone independent has tested security.
- Backups of Redis and the `UPLOADS_DIR` folder (driver documents) on an encrypted disk.
