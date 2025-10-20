#!/usr/bin/env bash
set -euo pipefail

# URL="https://coherent-ape-genuine.ngrok-free.app/webhooks/merciyanis"
# URL="https://webhooks-cnp-sandbox.spinalcom.com/webhooks/merciyanis"
# URL="http://51.91.214.36:19053/webhooks/merciyanis"
URL="http://127.0.0.1:10103/webhooks/merciyanis"
SECRET="${1}"

# BODY='"data":{"title":" webhook test","description":"This is a test webhook sent from the test script.","_createdAt":"2024-10-01T12:00:00Z","_id":"id-blablabla-56","_number":"123","location":"id-location-123"}'
BODY='{"_ticket":"id-blablabla-56", "data": {"status": "IN_PROGRESS"}}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')"

echo "Sending webhook to $URL"
echo "Signature: $SIG"
# curl -X POST "$URL" \
#   -H "Content-Type: application/json" \
#   -H "User-Agent: MerciYanisHook/test" \
#   -H "X-MerciYanis-Event: CREATE_TICKET" \
#   -H "X-MerciYanis-Delivery: 11111111-2222-3333-4444-555555555555" \
#   -H "X-MerciYanis-Hook-ID: test-hook" \
#   -H "X-MerciYanis-Signature: $SIG" \
#   --data "$BODY" -i


  curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "User-Agent: MerciYanisHook/test" \
  -H "X-MerciYanis-Event: UPDATE_TICKET" \
  -H "X-MerciYanis-Delivery: 11111111-2222-3333-4444-555555555555" \
  -H "X-MerciYanis-Hook-ID: test-hook" \
  -H "X-MerciYanis-Signature: $SIG" \
  --data "$BODY" -i