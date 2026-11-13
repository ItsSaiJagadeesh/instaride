#!/usr/bin/env bash
# Tells a running server which Firebase project its phone sign-in belongs to, so it can check Firebase's proof.
#   cd ~/instaride/deploy && sudo bash set-firebase.sh        # asks for the project id
#   sudo bash set-firebase.sh off                              # switches it off again (back to codes from this server)
# The project id is not a secret (it is in google-services.json under project_info). Numbers in OTP_FIXED keep using their fixed code.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${ENV_FILE:-.env}"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die "$ENV_FILE was not found. Run setup-server.sh first."

if [ "${1:-}" = "off" ]; then
  ID=""
else
  say "Firebase project id (Firebase console, Project settings, or the project_id line in google-services.json)"
  read -r -p "Project id: " ID
  ID="$(printf '%s' "$ID" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')" # trim the ends only; spaces inside are refused below
  [[ "$ID" =~ ^[a-z][a-z0-9-]{3,29}$ ]] || die "That does not look like a Firebase project id (small letters, numbers and dashes, for example instaride-9f5eb). Nothing was changed."
fi

umask 077
TMP="$(mktemp)"
grep -vE '^FIREBASE_PROJECT_ID=' "$ENV_FILE" > "$TMP" || true
echo "FIREBASE_PROJECT_ID=$ID" >> "$TMP"
cp -p "$ENV_FILE" "$ENV_FILE.bak"; chmod 600 "$ENV_FILE.bak"
cat "$TMP" > "$ENV_FILE"; rm -f "$TMP"; chmod 600 "$ENV_FILE"
if [ -n "$ID" ]; then echo "Saved FIREBASE_PROJECT_ID=$ID. The previous settings are kept in $ENV_FILE.bak"; else echo "Firebase sign-in switched off. The previous settings are kept in $ENV_FILE.bak"; fi

if [ "${NO_RESTART:-0}" = "1" ]; then
  say "Not restarting (NO_RESTART=1)."
else
  say "Restarting the app"
  docker compose up -d --force-recreate app
  docker compose ps
fi
say "Done."
if [ -n "$ID" ]; then
  echo "From now on, numbers that are not in OTP_FIXED sign in with Firebase. Apps built before Firebase was added cannot sign in those numbers until they are updated."
fi
