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

**5. SMS.** Create the SMS account (Twilio is built in) and finish DLT registration. The easy way: on the server run `cd ~/instaride/deploy && sudo bash set-twilio.sh`. It asks for the details privately, can send one test text to your own phone, and restarts the app. A Twilio **trial** account can only text numbers you have verified in the Twilio console, and India needs DLT for delivery. Or do it by hand: put these in `deploy/.env` on the server and run
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

**6b. The map (Mappls).** The phone app uses the Mappls map, search and routes. Mappls needs two licence files that are tied to your app's
package name and to your signing key, so do this **after step 7** (the permanent signing key). Until then a build shows a clearly labelled map
placeholder and everything else works.
1. Get your key's fingerprint: run `keytool -list -v -keystore instaride-upload.jks -alias instaride` and copy the **SHA256** line.
2. In the Mappls console (`auth.mappls.com/console`), create or edit your **Android** app: package name `in.instaride.app`, signing certificate = that SHA-256.
   Changing the key later means doing this again, because the files are issued per key.
3. In the app's **Config Files** section download the files as a **ZIP** (it holds one `.a.olf` and one `.a.conf`).
4. Turn the zip into secret text: `powershell -ExecutionPolicy Bypass -File scripts\make-mappls-secret.ps1 -Zip "C:\path\to\your-zip.zip"`.
   Copy the text from Notepad into a GitHub secret named `MAPPLS_ANDROID_CONFIG_ZIP_BASE64`, then delete the text file.
5. Run the build. A Mappls build says `map: Mappls map` in `build-info.txt`. If the files are saved but the build is not signed with your own
   key, the workflow warns and uses the placeholder instead of a map that Mappls would reject.

Good to know: the two files are packaged **inside every app file**, like any map licence, so anyone holding the app can extract them. They are tied to your
package name and key, not passwords, but keep them out of the repository. Mappls's terms apply: the Mappls logo and copyright must stay visible,
and your plan's daily usage limit is shown on its dashboard (usage from the app, web and other apps all counts). Read the terms and limits before you rely on it.

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
