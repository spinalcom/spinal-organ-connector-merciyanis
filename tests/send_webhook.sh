#!/usr/bin/env bash
set -euo pipefail

URL="https://coherent-ape-genuine.ngrok-free.app/webhooks/merciyanis"
SECRET="${1}"

BODY='{"title":"Hello webhook test"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')"

echo "Sending webhook to $URL"
echo "Signature: $SIG"
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "User-Agent: MerciYanisHook/test" \
  -H "X-MerciYanis-Event: CREATE_TICKET" \
  -H "X-MerciYanis-Delivery: 11111111-2222-3333-4444-555555555555" \
  -H "X-MerciYanis-Hook-ID: test-hook" \
  -H "X-MerciYanis-Signature: $SIG" \
  --data "$BODY" -i