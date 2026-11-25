#!/usr/bin/env bash
# Prints the certificate public-key pins (base64 SHA-256 of the SPKI) for a host, for EXPO_PUBLIC_PINS.
# Usage: bash scripts/get-pins.sh api.example.com
# Needs openssl. Run it on your server or laptop (Git Bash on Windows works).
set -euo pipefail
host="${1:?usage: get-pins.sh host}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo | openssl s_client -servername "$host" -connect "$host:443" -showcerts 2>/dev/null | awk -v d="$tmp" '/BEGIN CERTIFICATE/{n++} n>0{print > d"/c"n".pem"}'
i=0
for f in "$tmp"/c*.pem; do
  i=$((i+1))
  pin="$(openssl x509 -in "$f" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64)"
  subj="$(openssl x509 -in "$f" -noout -subject | sed 's/^subject=//')"
  echo "cert $i  $pin   ($subj)"
done
echo
echo 'Use the leaf pin AND the intermediate pin (a backup), like:'
echo "EXPO_PUBLIC_PINS='{\"$host\":{\"publicKeyHashes\":[\"<cert 1 pin>\",\"<cert 2 pin>\"]}}'"
