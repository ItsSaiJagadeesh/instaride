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
