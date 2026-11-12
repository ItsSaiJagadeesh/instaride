#!/usr/bin/env bash
# Connect Twilio (sign-in codes by SMS) to a server that is already running.
#   cd ~/instaride/deploy && sudo bash set-twilio.sh
# It asks for your Twilio details (the Auth Token is not shown), saves them in .env (readable only by you),
# can send ONE test text to your own phone so you know at once whether Twilio accepts them, and restarts the app.
# Nothing secret is ever printed.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${ENV_FILE:-.env}"
BASE="${TWILIO_API_BASE:-https://api.twilio.com}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die "$ENV_FILE was not found. Run setup-server.sh first."

say "Twilio details (find them on console.twilio.com, on the home page and under Phone Numbers)"
read -r -p "Account SID (starts with AC): " SID
read -r -s -p "Auth Token (not shown): " TOKEN; echo
read -r -p "Sender: your Twilio phone number like +1555..., or a Messaging Service SID starting with MG: " FROM
SID="${SID//[[:space:]]/}"; TOKEN="${TOKEN//[[:space:]]/}"; FROM="${FROM//[[:space:]]/}"

[[ "$SID" =~ ^AC[0-9a-fA-F]{32}$ ]] || die "That does not look like an Account SID. It starts with AC and is 34 characters long. Nothing was changed."
[[ "$TOKEN" =~ ^[0-9a-zA-Z]{32}$ ]] || die "That does not look like an Auth Token. It is 32 letters and numbers. Nothing was changed."
if [[ "$FROM" =~ ^\+[0-9]{8,15}$ ]]; then SENDER_KEY="TWILIO_FROM"
elif [[ "$FROM" =~ ^MG[0-9a-fA-F]{32}$ ]]; then SENDER_KEY="TWILIO_MESSAGING_SERVICE_SID"
else die "The sender must be a phone number starting with + (for example +15551234567) or a Messaging Service SID starting with MG. Nothing was changed."; fi

read -r -p "Keep the fixed test code (OTP_FIXED) for now, so you cannot lock yourself out while testing? [Y/n]: " keep
keep="${keep:-Y}"

say "Saving to $ENV_FILE"
umask 077
TMP="$(mktemp)"
grep -vE '^(SMS_PROVIDER|TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_FROM|TWILIO_MESSAGING_SERVICE_SID)=' "$ENV_FILE" > "$TMP" || true
if [[ "$keep" =~ ^[Nn] ]]; then
  grep -vE '^OTP_FIXED=' "$TMP" > "$TMP.2" || true
  mv "$TMP.2" "$TMP"
  echo "OTP_FIXED=" >> "$TMP"
fi
{
  echo "SMS_PROVIDER=twilio"
  echo "TWILIO_ACCOUNT_SID=$SID"
  echo "TWILIO_AUTH_TOKEN=$TOKEN"
  echo "$SENDER_KEY=$FROM"
} >> "$TMP"
cp -p "$ENV_FILE" "$ENV_FILE.bak"; chmod 600 "$ENV_FILE.bak"
cat "$TMP" > "$ENV_FILE"; rm -f "$TMP"; chmod 600 "$ENV_FILE"
echo "Saved. The previous settings are kept in $ENV_FILE.bak"

say "Test text (optional)"
echo "A Twilio TRIAL account can only text numbers you have verified in the Twilio console (Phone Numbers, Verified Caller IDs)."
read -r -p "Your 10-digit mobile number to receive one test text, or press Enter to skip: " TO
TO="${TO//[[:space:]]/}"
if [ -n "$TO" ]; then
  [[ "$TO" =~ ^[6-9][0-9]{9}$ ]] || die "That is not a 10-digit Indian mobile number. Your Twilio details are saved; run this script again to send a test."
  args=(--data-urlencode "To=+91$TO" --data-urlencode "Body=InstaRide test: Twilio is connected.")
  if [ "$SENDER_KEY" = "TWILIO_FROM" ]; then args+=(--data-urlencode "From=$FROM"); else args+=(--data-urlencode "MessagingServiceSid=$FROM"); fi
  # the credentials go to curl on stdin, so they never appear in the process list
  out="$(curl -sS -m 25 -K - "${args[@]}" "$BASE/2010-04-01/Accounts/$SID/Messages.json" <<CURLCFG || true
user = "$SID:$TOKEN"
CURLCFG
)"
  if printf '%s' "$out" | grep -q '"sid"[[:space:]]*:[[:space:]]*"SM'; then
    echo "Twilio accepted the message. It should reach your phone within a minute."
    echo "(If it never arrives, Indian networks may be blocking it: Twilio needs a DLT-registered sender for India.)"
  else
    msg="$(printf '%s' "$out" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(str(d.get("message","")) + ("  (code " + str(d["code"]) + ")" if d.get("code") else ""))
except Exception:
    print("no readable answer from Twilio")' 2>/dev/null || echo "no readable answer from Twilio")"
    printf '\033[33mTwilio did not send it. Twilio said: %s\033[0m\n' "$msg"
    case "$msg" in
      *20003*) echo "Hint: the Account SID or Auth Token is wrong. Run this script again." ;;
      *21608*) echo "Hint: verify this number first (Twilio console, Phone Numbers, Verified Caller IDs), or upgrade the account." ;;
      *21408*) echo "Hint: switch India on in Twilio (Messaging, Settings, Geo permissions)." ;;
      *21211*|*21614*) echo "Hint: Twilio does not accept that phone number." ;;
    esac
  fi
fi

if [ "${NO_RESTART:-0}" = "1" ]; then
  say "Not restarting (NO_RESTART=1)."
else
  say "Restarting the app so it uses Twilio"
  docker compose up -d --force-recreate app
  docker compose ps
fi

say "Twilio is set up."
echo "Open the app and request a sign-in code for a number you verified in Twilio."
echo "When real texts arrive, you can remove the fixed test code: edit .env, set OTP_FIXED= (empty), and run: docker compose up -d --force-recreate app"
