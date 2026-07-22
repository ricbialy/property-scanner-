#!/usr/bin/env bash
# One-command owner test environment (make test-demo).
#
# Starts PostgreSQL, the API (:4000), the worker, the web app (:3000), and a
# StudioKL simulator (:4300); seeds a realistic property; runs every fixture
# scenario (success, interrupted upload, missing wall, unsupported schema,
# processing failure, cross-tenant attempt, accepted revision -> signed webhook
# -> simulated StudioKL import); then prints the URLs to explore. Services keep
# running until `make stop-demo`.
set -euo pipefail
cd "$(dirname "$0")/.."

export APP_ENV=development
export DATABASE_URL="${DATABASE_URL:-postgres://propertyscan:propertyscan@localhost:5432/propertyscan}"
export AUTH_MODE=dev
export STORAGE_DRIVER=fs
export STORAGE_FS_ROOT=".local/objects"
export WEBHOOK_MASTER_ENCRYPTION_KEY="dev-only-not-a-real-key-0000000000000000"
export DISABLE_EXTERNAL_WEBHOOKS=true
export API_BASE_URL="http://localhost:4000"
export API_PORT=4000
export WEB_BASE_URL="http://localhost:3000"
export LOG_LEVEL=warn
export APP_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

API="http://localhost:4000"
AUTH="authorization: Bearer dev_user_demo_owner"
CT='content-type: application/json'
PIDDIR=".local/pids"
mkdir -p "$PIDDIR" .local

say() { echo; echo "==> $1"; }
jqf() { node -p "JSON.parse(require('fs').readFileSync(0))$1"; }

./scripts/local-infra.sh up >/dev/null
pnpm db:migrate >/dev/null

if [ ! -f apps/api/dist/main.js ] || [ ! -d apps/web/.next ]; then
  say "Building (first run only)"
  pnpm build >/dev/null
fi

say "Starting services (logs in .local/logs/)"
./scripts/stop-demo.sh >/dev/null 2>&1 || true
mkdir -p .local/logs
node apps/api/dist/main.js > .local/logs/api.log 2>&1 & echo $! > "$PIDDIR/api.pid"
node apps/worker/dist/main.js > .local/logs/worker.log 2>&1 & echo $! > "$PIDDIR/worker.pid"
(cd apps/web && exec node_modules/.bin/next start --port 3000 > ../../.local/logs/web.log 2>&1) & echo $! > "$PIDDIR/web.pid"

for _ in $(seq 1 60); do curl -sf "$API/health/ready" >/dev/null && break; sleep 0.3; done
curl -sf "$API/health/ready" >/dev/null || { echo "API failed to start"; exit 1; }

say "Seeding organization, property, floor"
ORG_ID=$(curl -sf -X POST "$API/v1/organizations" -H "$AUTH" -H "$CT" \
  -d '{"name":"Field Test Construction Co"}' | jqf .id)
ORG="x-organization-id: $ORG_ID"
PROPERTY_ID=$(curl -sf -X POST "$API/v1/properties" -H "$AUTH" -H "$ORG" -H "$CT" \
  -d '{"name":"12 Cedar Lane (demo)","city":"Springfield","region":"IL","country":"US"}' | jqf .id)
FLOOR_ID=$(curl -sf -X POST "$API/v1/properties/$PROPERTY_ID/floors" -H "$AUTH" -H "$ORG" -H "$CT" \
  -d '{"name":"First Floor","ordinal":0}' | jqf .id)

say "Starting StudioKL simulator (:4300)"
WEBHOOK_SECRET="studiokl-simulator-secret-0001" API_BASE_URL="$API" \
  PS_TOKEN="dev_user_demo_owner" PS_ORG="$ORG_ID" SIMULATOR_PORT=4300 \
  node scripts/studiokl-simulator.mjs > .local/logs/studiokl-simulator.log 2>&1 & echo $! > "$PIDDIR/simulator.pid"
sleep 0.5
curl -sf -X POST "$API/v1/webhook-endpoints" -H "$AUTH" -H "$ORG" -H "$CT" \
  -d '{"url":"http://127.0.0.1:4300/webhooks","secret":"studiokl-simulator-secret-0001"}' >/dev/null

new_session() { # $1 = label
  curl -sf -X POST "$API/v1/scan-sessions" -H "$AUTH" -H "$ORG" -H "$CT" \
    -H "idempotency-key: demo-$1-$(date +%s%N)" \
    -d "{\"propertyId\":\"$PROPERTY_ID\",\"floorId\":\"$FLOOR_ID\",\"requestedOutputs\":[\"normalized_json\"]}" | jqf .id
}

walk_states() { # $1 = session
  for T in '{"from":"draft","to":"capturing"}' '{"from":"capturing","to":"local_review"}' \
           '{"from":"local_review","to":"queued_upload"}' '{"from":"queued_upload","to":"uploading"}'; do
    curl -sf -X POST "$API/v1/scan-sessions/$1/status" -H "$AUTH" -H "$ORG" -H "$CT" -d "$T" >/dev/null
  done
}

upload_bundle() { # $1 = session, $2 = variant ("" = default)
  node scripts/build-demo-bundle.mjs "$1" ${2:+"$2"}
  local CAP BYTES SHA UP UPID
  CAP=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).captureId')
  BYTES=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).byteSize')
  SHA=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).sha256')
  UP=$(curl -sf -X POST "$API/v1/scan-sessions/$1/uploads" -H "$AUTH" -H "$ORG" -H "$CT" \
    -d "{\"captureId\":\"$CAP\",\"byteSize\":$BYTES,\"contentType\":\"application/zip\"}")
  UPID=$(echo "$UP" | jqf .uploadId)
  curl -sf -X PUT "$API/v1/scan-sessions/$1/uploads/$UPID/content" -H "$AUTH" -H "$ORG" \
    -H 'content-type: application/zip' --data-binary @.local/demo-bundle.zip >/dev/null
  curl -sf -X POST "$API/v1/scan-sessions/$1/uploads/$UPID/complete" -H "$AUTH" -H "$ORG" -H "$CT" \
    -d "{\"sha256\":\"$SHA\",\"byteSize\":$BYTES}" >/dev/null
  curl -sf -X POST "$API/v1/scan-sessions/$1/complete" -H "$AUTH" -H "$ORG" >/dev/null
}

wait_session() { # $1 = session; echoes final status
  for _ in $(seq 1 60); do
    S=$(curl -sf "$API/v1/scan-sessions/$1" -H "$AUTH" -H "$ORG")
    ST=$(echo "$S" | jqf .status)
    if [ "$ST" = "needs_review" ] || [ "$ST" = "failed" ]; then echo "$S"; return; fi
    sleep 0.5
  done
  echo "$S"
}

say "Scenario 1 — interrupted upload that resumes, then normal processing"
S1=$(new_session s1); walk_states "$S1"
node scripts/build-demo-bundle.mjs "$S1"
CAP=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).captureId')
BYTES=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).byteSize')
SHA=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).sha256')
UP=$(curl -sf -X POST "$API/v1/scan-sessions/$S1/uploads" -H "$AUTH" -H "$ORG" -H "$CT" \
  -d "{\"captureId\":\"$CAP\",\"byteSize\":$BYTES,\"contentType\":\"application/zip\",\"partCount\":3}")
UPID=$(echo "$UP" | jqf .uploadId)
PART=$(( (BYTES + 2) / 3 ))
split -b "$PART" -d .local/demo-bundle.zip .local/demo-part.
curl -sf -X PUT "$API/v1/scan-sessions/$S1/uploads/$UPID/parts/2" -H "$AUTH" -H "$ORG" \
  -H 'content-type: application/octet-stream' --data-binary @.local/demo-part.01 >/dev/null
echo "  simulated connection loss after part 2 of 3; server reports:"
curl -sf "$API/v1/scan-sessions/$S1/uploads/$UPID" -H "$AUTH" -H "$ORG" \
  | node -p 'const s=JSON.parse(require("fs").readFileSync(0)); `    received ${JSON.stringify(s.receivedParts)}, missing ${JSON.stringify(s.missingParts)}`'
curl -sf -X PUT "$API/v1/scan-sessions/$S1/uploads/$UPID/parts/1" -H "$AUTH" -H "$ORG" \
  -H 'content-type: application/octet-stream' --data-binary @.local/demo-part.00 >/dev/null
curl -sf -X PUT "$API/v1/scan-sessions/$S1/uploads/$UPID/parts/3" -H "$AUTH" -H "$ORG" \
  -H 'content-type: application/octet-stream' --data-binary @.local/demo-part.02 >/dev/null
curl -sf -X POST "$API/v1/scan-sessions/$S1/uploads/$UPID/complete" -H "$AUTH" -H "$ORG" -H "$CT" \
  -d "{\"sha256\":\"$SHA\",\"byteSize\":$BYTES}" >/dev/null
curl -sf -X POST "$API/v1/scan-sessions/$S1/complete" -H "$AUTH" -H "$ORG" >/dev/null
R1=$(wait_session "$S1"); PLAN1=$(echo "$R1" | jqf .planId)
echo "  -> $(echo "$R1" | jqf .status), plan $PLAN1 (review this one in the browser)"

say "Scenario 2 — corrected + accepted revision -> signed webhook -> StudioKL import"
S2=$(new_session s2); walk_states "$S2"; upload_bundle "$S2"
R2=$(wait_session "$S2"); PLAN2=$(echo "$R2" | jqf .planId)
REV2=$(curl -sf "$API/v1/plans/$PLAN2" -H "$AUTH" -H "$ORG" | jqf .currentRevisionId)
ROOM2=$(curl -sf "$API/v1/plans/$PLAN2" -H "$AUTH" -H "$ORG" | jqf .currentRevision.payload.rooms[0].id)
NEWREV=$(curl -sf -X POST "$API/v1/plans/$PLAN2/revisions" -H "$AUTH" -H "$ORG" -H "$CT" \
  -d "{\"parentRevisionId\":\"$REV2\",\"reason\":\"demo correction\",\"commands\":[{\"type\":\"renameRoom\",\"roomId\":\"$ROOM2\",\"name\":\"Kitchen (demo corrected)\"}]}" | jqf .id)
curl -sf -X POST "$API/v1/plans/$PLAN2/revisions/$NEWREV/accept" -H "$AUTH" -H "$ORG" >/dev/null
echo "  revision v2 accepted; waiting for webhook delivery + simulator import…"
for _ in $(seq 1 30); do [ -f .local/studiokl-import.json ] && break; sleep 0.5; done
if [ -f .local/studiokl-import.json ]; then
  node -p 'const i=JSON.parse(require("fs").readFileSync(".local/studiokl-import.json")); `  StudioKL imported ${i[i.length-1].windows.length} windows, ${i[i.length-1].doors.length} doors (${i[i.length-1].needsHumanReview} need human review) -> .local/studiokl-import.json`'
else
  echo "  WARNING: simulator import did not arrive in time — check worker logs"
fi

say "Scenario 3 — missing wall (unclosable room stays honest)"
S3=$(new_session s3); walk_states "$S3"; upload_bundle "$S3" "missing-wall"
R3=$(wait_session "$S3"); PLAN3=$(echo "$R3" | jqf .planId)
echo "  -> $(echo "$R3" | jqf .status); finding: $(curl -sf "$API/v1/plans/$PLAN3" -H "$AUTH" -H "$ORG" | jqf ".currentRevision.payload.validationFindings.find(f=>f.code==='room_not_closed').code")"

say "Scenario 4 — unsupported RoomPlan schema (visible processing failure)"
S4=$(new_session s4); walk_states "$S4"; upload_bundle "$S4" "unsupported-schema"
R4=$(wait_session "$S4")
echo "  -> $(echo "$R4" | jqf .status): $(echo "$R4" | jqf .failureReason)"

say "Scenario 5 — cross-tenant access attempt"
INTRUDER_ORG=$(curl -sf -X POST "$API/v1/organizations" -H "authorization: Bearer dev_user_intruder" -H "$CT" \
  -d '{"name":"Intruder Co"}' | jqf .id)
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/v1/plans/$PLAN1" \
  -H "authorization: Bearer dev_user_intruder" -H "x-organization-id: $INTRUDER_ORG")
echo "  intruder org requesting demo plan -> HTTP $CODE (expected 404)"

echo
echo "============================================================"
echo " Test environment is RUNNING. Open these in your browser:"
echo "   Dashboard:      http://localhost:3000"
echo "   Review plan:    http://localhost:3000/plans/$PLAN1?org=$ORG_ID"
echo "   Testing panel:  http://localhost:3000/status"
echo "   API health:     $API/health/ready"
echo " StudioKL import:  .local/studiokl-import.json"
echo " Stop everything:  make stop-demo"
echo "============================================================"
