#!/usr/bin/env bash
# Switches the fixed sign-in codes (OTP_FIXED) on or off in production. They are a testing tool: in production the server
# ignores them unless ALLOW_FIXED_OTP is exactly "yes".
#   cd ~/instaride/deploy && sudo bash set-fixed-otp.sh on      # pilot / store review: the listed numbers use their fixed code
#   sudo bash set-fixed-otp.sh off                               # ignore the list (kept for later), everyone uses real texts
#   sudo bash set-fixed-otp.sh clear                             # off, and empty the list
# Neither the numbers nor the codes are printed.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${ENV_FILE:-.env}"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die "$ENV_FILE was not found. Run setup-server.sh first."

CLEAR=0
case "${1:-}" in
  on) FLAG=yes ;;
  off) FLAG=no ;;
  clear) FLAG=no; CLEAR=1 ;;
  *) die "Say what you want: on, off or clear. For example: sudo bash set-fixed-otp.sh off" ;;
esac

umask 077
TMP="$(mktemp)"
if [ "$CLEAR" = "1" ]; then
  grep -vE '^(ALLOW_FIXED_OTP|OTP_FIXED)=' "$ENV_FILE" > "$TMP" || true
  echo "OTP_FIXED=" >> "$TMP"
else
  grep -vE '^ALLOW_FIXED_OTP=' "$ENV_FILE" > "$TMP" || true
fi
echo "ALLOW_FIXED_OTP=$FLAG" >> "$TMP"
cp -p "$ENV_FILE" "$ENV_FILE.bak"; chmod 600 "$ENV_FILE.bak"
cat "$TMP" > "$ENV_FILE"; rm -f "$TMP"; chmod 600 "$ENV_FILE"

COUNT="$(grep -E '^OTP_FIXED=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr ',' '\n' | grep -c ':' || true)"
case "$FLAG$CLEAR" in
  yes*) echo "Fixed codes are ON for $COUNT number(s). Only use this for the pilot and store review." ;;
  no1)  echo "Fixed codes are OFF and the list is emptied. Everyone uses real text messages." ;;
  *)    echo "Fixed codes are OFF. The list of $COUNT number(s) is kept but ignored. Everyone uses real text messages." ;;
esac
echo "The previous settings are kept in $ENV_FILE.bak"

if [ "${NO_RESTART:-0}" = "1" ]; then
  say "Not restarting (NO_RESTART=1)."
else
  say "Restarting the app"
  docker compose up -d --force-recreate app
  docker compose ps
fi
say "Done."
