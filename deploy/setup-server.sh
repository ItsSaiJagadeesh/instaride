#!/usr/bin/env bash
# One-command setup for a fresh Ubuntu or Debian server (a small VPS is enough).
#
#   1. Point your domain at the server first (an "A record" at your registrar).
#   2. Copy the project folder to the server, then run:   sudo bash deploy/setup-server.sh
#
# It asks a few questions, installs Docker if missing, writes deploy/.env (private, mode 600),
# opens only the ports 22, 80 and 443, starts everything and waits until https answers.
# Answers can also be given as environment variables (DOMAIN, ADMIN_PHONE, ADMIN_PASSWORD, GEOCODER_CONTACT,
# SMS_PROVIDER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, OTP_FIXED).
# Test mode: DRY_RUN=1 writes the .env only and changes nothing else on the machine.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$(cd "$(dirname "$0")" && pwd)}"
ENV_FILE="$DEPLOY_DIR/.env"
DRY_RUN="${DRY_RUN:-0}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

ask() { # ask VAR "Question" [default]
  local var="$1" question="$2" default="${3:-}" reply
  if [ -n "${!var:-}" ]; then return 0; fi
  [ -t 0 ] || die "$var is not set and there is no keyboard to ask. Set it as an environment variable."
  if [ -n "$default" ]; then read -r -p "$question [$default]: " reply; reply="${reply:-$default}"
  else read -r -p "$question: " reply; fi
  printf -v "$var" '%s' "$reply"
}

ask_secret() { # ask_secret VAR "Question"
  local var="$1" question="$2" reply
  if [ -n "${!var:-}" ]; then return 0; fi
  [ -t 0 ] || die "$var is not set and there is no keyboard to ask. Set it as an environment variable."
  read -r -s -p "$question: " reply; echo
  printf -v "$var" '%s' "$reply"
}

if [ "$DRY_RUN" != "1" ]; then
  [ "$(id -u)" -eq 0 ] || die "Run this with sudo:  sudo bash deploy/setup-server.sh"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}${ID_LIKE:-}" in *ubuntu*|*debian*) ;; *) warn "This script is written for Ubuntu or Debian (found: ${PRETTY_NAME:-unknown}). Continue at your own risk." ;; esac
  fi
fi

say "1/5  Your answers"
ask DOMAIN "Domain name pointed at this server (for example api.yourdomain.in)"
ask ADMIN_PHONE "Super Admin mobile number (10 digits, used to sign in to the console)"
ask_secret ADMIN_PASSWORD "Super Admin password (12 or more characters; it is not shown)"
ask GEOCODER_CONTACT "Contact email for address-search requests"

[[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] || die "That does not look like a domain name: $DOMAIN"
[[ "$ADMIN_PHONE" =~ ^[6-9][0-9]{9}$ ]] || die "The admin number must be 10 digits starting with 6, 7, 8 or 9."
[ "${#ADMIN_PASSWORD}" -ge 12 ] || die "The admin password must be at least 12 characters."
[[ "$GEOCODER_CONTACT" == *@*.* ]] || die "Please give a real email address for address-search requests."
case "$ADMIN_PASSWORD" in *\'*|*\"*|*\\*|*\$*|*\`*|*' '*) die "Please avoid quotes, spaces, backslashes, \$ and backticks in the password (they break the settings file)." ;; esac

SMS_PROVIDER="${SMS_PROVIDER:-}"
if [ -z "$SMS_PROVIDER" ] && [ -t 0 ]; then
  read -r -p "Set up Twilio for sign-in codes now? You can also do it later in deploy/.env [y/N]: " yn
  if [[ "${yn:-n}" =~ ^[Yy] ]]; then
    SMS_PROVIDER=twilio
    ask TWILIO_ACCOUNT_SID "Twilio Account SID"
    ask_secret TWILIO_AUTH_TOKEN "Twilio Auth Token (not shown)"
    ask TWILIO_FROM "Twilio sender number (like +1555...)"
  fi
fi

if [ -e "$ENV_FILE" ] && [ "${FORCE:-0}" != "1" ]; then
  die "$ENV_FILE already exists. To start over run with FORCE=1 (the old file is kept as .env.old)."
fi
[ ! -e "$ENV_FILE" ] || cp "$ENV_FILE" "$ENV_FILE.old"

if command -v openssl >/dev/null 2>&1; then SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n=/+')"
else SESSION_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n=/+')"; fi

say "2/5  Writing $ENV_FILE (readable only by you)"
umask 077
{
  echo "DOMAIN=$DOMAIN"
  echo "ADMIN_PHONE=$ADMIN_PHONE"
  echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
  echo "SESSION_SECRET=$SESSION_SECRET"
  echo "GEOCODER_CONTACT=$GEOCODER_CONTACT"
  echo "SMS_PROVIDER=${SMS_PROVIDER:-}"
  echo "TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID:-}"
  echo "TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN:-}"
  echo "TWILIO_FROM=${TWILIO_FROM:-}"
  echo "OTP_FIXED=${OTP_FIXED:-}"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Done. A long random login secret was generated for you."

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN finished: nothing was installed or started."
  exit 0
fi

say "3/5  Docker and the firewall"
if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker (the official convenience script from get.docker.com)..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose is missing. Install the docker-compose-plugin package and run this again."

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  echo "Firewall: only SSH, 80 and 443 are open."
else
  warn "ufw is not installed, so no firewall was set up. Make sure only ports 22, 80 and 443 are reachable (your provider's panel may have a firewall)."
fi

say "4/5  Is the domain pointed at this server?"
if [ "${SKIP_DNS_CHECK:-0}" != "1" ]; then
  DNS_IP="$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)"
  MY_IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$DNS_IP" ]; then
    warn "$DOMAIN does not resolve yet. Add an A record pointing to this server's IP${MY_IP:+ ($MY_IP)}, wait a few minutes, then run this again."
    exit 1
  elif [ -n "$MY_IP" ] && [ "$DNS_IP" != "$MY_IP" ]; then
    warn "$DOMAIN points to $DNS_IP but this server is $MY_IP. The https certificate cannot be issued until they match."
    if [ -t 0 ]; then read -r -p "Continue anyway? [y/N]: " go; [[ "${go:-n}" =~ ^[Yy] ]] || exit 1; else exit 1; fi
  else
    echo "Good: $DOMAIN points to ${DNS_IP}."
  fi
fi

say "5/5  Starting everything (the first build takes a few minutes)"
cd "$DEPLOY_DIR"
mkdir -p backups
docker compose up -d --build

echo "Waiting for https to answer..."
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    say "InstaRide is live."
    echo "  Console:  https://$DOMAIN/console/   (phone $ADMIN_PHONE and the password you chose)"
    echo "  Next:     open the console, then the Go-live meter, and work down the list."
    echo "  Backups:  $DEPLOY_DIR/backups  (copy them off this server regularly)"
    echo "  Logs:     cd $DEPLOY_DIR && docker compose logs -f app"
    exit 0
  fi
  sleep 3
done
warn "It did not answer within 3 minutes. Look at the logs:  cd $DEPLOY_DIR && docker compose logs --tail 50 caddy app"
exit 1
