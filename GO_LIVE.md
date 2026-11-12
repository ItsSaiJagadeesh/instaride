# Go live: from working code to real users

You have working code. This page connects it to the "supply": a server, https, SMS, a signed Android file and the Play Store.
Think of it as an electricity meter. **Most steps are automatic. A few can only be done by you**, because they prove who you are.

The **Go-live meter** inside the Super Admin console (`/console/`, tab "Go-live meter") reads the real state of your server and shows
every item as green, amber or red, with what to do next. Work down it until it is green.

## What is automatic and what is yours

| Connection | Automatic | Only you can do |
| --- | --- | --- |
| Server, https certificate, database, daily backups | `deploy/setup-server.sh` does it in one go | Rent the server and buy the domain **in your own name**; point the domain at the server |
| Android file (APK and Play Store .aab) | GitHub builds and signs it with one click | Create the GitHub account; create the signing key once (a script helps) |
| Sign-in codes by SMS | The code is built in | Open the SMS account, complete DLT registration, add credit |
| Play Store listing | Texts and checklists are prepared (`PLAY_STORE.md`) | Google Play account, verification, fee, any required testing period |
| Legal pages | Drafts are served at `/legal/...` | Fill in your business details; a lawyer reviews them |
| Licences, insurance, RTO answer | The meter reminds you | Get the answers in writing |

## The order

**1. Put the project on GitHub** (free). The code is GPL, so the repository is public. Your `.gitignore` already blocks `.env`,
signing keys, server settings and backups. Before you push, run `git status` and check none of those appear.

**2. Rent a server and buy a domain**, both in your own name. A small Ubuntu server in an India region is enough to start (2 GB of
memory is comfortable; check the provider's current prices). At your registrar add an **A record**: `api` (or the name you chose)
pointing to the server's IP address. Wait a few minutes.

**3. Set up the server.** Copy the project folder to the server (`git clone` your repository, or `scp`), then:
```bash
sudo bash deploy/setup-server.sh
```
It asks for your domain, the Super Admin phone and password, and a contact email. It installs Docker if needed, writes a private
settings file, opens only ports 22, 80 and 443, starts everything and waits until `https://your-domain/api/health` answers.

**4. Open the console and watch the meter.** `https://your-domain/console/` → sign in → **Go-live meter**. Red items need fixing now,
amber items need a look, and the grey "only a person can do these" items you tick yourself when they are really done.

**5. SMS.** Create the SMS account (Twilio is built in), finish DLT registration, then put these in `deploy/.env` on the server and run
`docker compose up -d` from the `deploy` folder:
```
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+...
```
Also add one or two **demo numbers** for Google's reviewers: `OTP_FIXED=9XXXXXXXXX:123456`. Use numbers you own that hold no real data
and remove them after approval.

**6. Build the Android app on GitHub.** Repository → **Actions** → **Build Android app** → **Run workflow**.
- `kind = demo`: the server-free demo. Good first run to see that building works.
- `kind = live`, `server_address = api.yourdomain.in`: the real app pointing at your server.
When it finishes, open the run and download **instaride-android** from the Artifacts box. Install `instaride.apk` on a phone.

**6b. A map key for the Android app.** The phone's map needs a Google Maps key built into the app. Without one the app is built with a clearly
labelled map placeholder (everything else still works), so the demo and early test builds need nothing. For the real app:
1. In the Google Cloud Console create a project, then enable **Maps SDK for Android** (it asks for a billing account; Google gives a free monthly allowance.
   Check its current pricing and limits before you rely on it).
2. Create an **API key**. Under *Application restrictions* choose **Android apps** and add your package name `in.instaride.app` with the **SHA-1** of the
   key that signs the app. Add one entry per signing key: your upload key (`keytool -list -v -keystore instaride-upload.jks`) and, once the app is on
   Google Play, Google's app-signing certificate (Play Console, Setup, App signing). Under *API restrictions* allow only Maps SDK for Android.
3. Add the key as a GitHub secret named `GOOGLE_MAPS_API_KEY`. A live build then includes the real map. The key ends up inside the app file, which is
   normal for map keys; the restrictions above are what stop others from using it.
Tick the matching step in the meter when done. The Google Play build refuses to run without this secret.

**7. Signing key, once, for Google Play.** Run `bash scripts/make-upload-key.sh` (or `scripts\make-upload-key.ps1` on Windows; needs a JDK).
Paste the four values from `github-secrets.txt` into the repository's *Settings → Secrets and variables → Actions*, delete that file,
and keep `instaride-upload.jks` somewhere safe and private. Then run the workflow with `kind = live` and **play_bundle** ticked to get
`instaride.aab` for the Play Console.

**8. Play Console.** Follow `PLAY_STORE.md`: store listing, privacy policy link, data safety form, reviewer access, testing rules.

**9. Fill in your business.** In the console: Settings (fares, service area, support contact, source-code link). Edit the pages in `legal/`
(remove every `[PLACEHOLDER]` and the red DRAFT box), redeploy with `deploy/update.sh`, and have them reviewed.

**10. Rehearse.** Two real phones: sign up, upload photos, approve in the console, book, share a trip, press SOS, delete an account. Then
restore a backup on a spare machine (`deploy/restore.sh`) so you know it works. Tick those two items in the meter.

## When something goes wrong

| Problem | Look here |
| --- | --- |
| Setup says the domain does not resolve | The A record is missing or still spreading. Wait and run the script again. |
| https never comes up | The domain must point at this server first. `cd deploy && docker compose logs caddy` |
| The app starts but the console says Redis is down | `docker compose ps`, then `docker compose logs redis` |
| No sign-in codes arrive | Meter, "Sign-in codes". Check `docker compose logs app`, and that the SMS account is out of trial mode and DLT is approved. |
| A GitHub build fails | Open the run, then the failed step. The Gradle log is also saved as the **build-log** artifact. |
| Everyone gets "too many attempts" | The meter's proxy item: `TRUST_PROXY` must be set (the deploy pack sets it). |

## Everyday commands (on the server, inside the `deploy` folder)

```bash
docker compose ps                # is everything running
docker compose logs -f app       # live log of the app
bash update.sh                   # after replacing the project files with a newer version
ls backups                       # daily backups (copy these OFF the server regularly)
```

## What has and has not been tested

Tested here: every script was run or linted with the real tools (shellcheck, hadolint, actionlint, Docker Compose, Caddy, PowerShell);
the server was run from the same files and the same three packages the image uses; backup, retention, failure handling and a restore
onto a clean Redis were exercised; the meter's checks and the console panel have automated tests; the workflow's input checks and
signing logic were run with a real key; and the Android project Expo generates was inspected to confirm what the workflow relies on
(the release file name, the signing set-up, that the version number from the workflow reaches the build, the architecture switch).

**Not tested** (it needs your machines and accounts): an actual Docker build and `docker compose up`, a real certificate from Let's Encrypt,
a real GitHub Actions run, Google's `apksigner`, the Android build itself, and a real SMS. The first time you run each, read the output and
tell me what it says: those are the places a surprise is most likely.
