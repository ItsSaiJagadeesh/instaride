#!/usr/bin/env bash
# Creates the key that signs your Android app, ONCE, and prepares the four GitHub secrets.
# Needs Java's "keytool" (install a JDK, for example Temurin 17). Run:  bash scripts/make-upload-key.sh
#
# Output (in the folder you run it from):
#   instaride-upload.jks          THE KEY. Keep a copy somewhere safe and private. If you lose it you cannot update your app.
#   github-secrets.txt            the four values to paste into GitHub, then DELETE this file.
# Nothing secret is printed on screen.
set -euo pipefail

command -v keytool >/dev/null 2>&1 || { echo "keytool was not found. Install a JDK (for example Temurin 17) and try again." >&2; exit 1; }
KEYSTORE="${KEYSTORE:-instaride-upload.jks}"
SECRETS="${SECRETS:-github-secrets.txt}"
ALIAS="${KEY_ALIAS:-instaride}"
[ ! -e "$KEYSTORE" ] || { echo "$KEYSTORE already exists. Refusing to overwrite your key. Move it away first if you really want a new one." >&2; exit 1; }

umask 077
PASS="$(head -c 24 /dev/urandom | base64 | tr -d '\n=/+' | head -c 24)"
keytool -genkeypair -keystore "$KEYSTORE" -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=InstaRide, O=InstaRide" >/dev/null 2>&1

B64="$(base64 < "$KEYSTORE" | tr -d '\n')"
{
  echo "Paste each value into GitHub: your repository, Settings, Secrets and variables, Actions, New repository secret."
  echo ""
  echo "Name:  ANDROID_KEYSTORE_BASE64"
  echo "Value: $B64"
  echo ""
  echo "Name:  ANDROID_KEYSTORE_PASSWORD"
  echo "Value: $PASS"
  echo ""
  echo "Name:  ANDROID_KEY_ALIAS"
  echo "Value: $ALIAS"
  echo ""
  echo "Name:  ANDROID_KEY_PASSWORD"
  echo "Value: $PASS"
} > "$SECRETS"

echo "Created $KEYSTORE (your signing key) and $SECRETS (the four GitHub secrets)."
echo "1) Paste the four values into GitHub as repository secrets, then delete $SECRETS."
echo "2) Keep $KEYSTORE and its password in a safe private place (a password manager or an encrypted drive). NEVER put it in the repository."
echo "3) With Google Play App Signing, Google holds the final key, but you still need this upload key for every update."
