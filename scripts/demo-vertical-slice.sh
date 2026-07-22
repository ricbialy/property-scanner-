#!/usr/bin/env bash
# End-to-end vertical slice demo (spec §21.5), placeholder-free:
#   create tenant/property/floor/session -> issue + redeem handoff link ->
#   upload the deterministic fixture bundle -> worker imports it ->
#   retrieve the normalized plan stub with explicit not_processed fields.
#
# Requires: local postgres running (make db-up), pnpm build completed.
set -euo pipefail
cd "$(dirname "$0")/.."

export APP_ENV=development
export DATABASE_URL="${DATABASE_URL:-postgres://propertyscan:propertyscan@localhost:5432/propertyscan}"
export AUTH_MODE=dev
export STORAGE_DRIVER=fs
export STORAGE_FS_ROOT=".local/objects"
export WEBHOOK_MASTER_ENCRYPTION_KEY="dev-only-not-a-real-key-0000000000000000"
export DISABLE_EXTERNAL_WEBHOOKS=true
export API_BASE_URL="http://localhost:4100"
export API_PORT=4100
export LOG_LEVEL=warn

API="http://localhost:4100"
AUTH="authorization: Bearer dev_user_demo_owner"

pnpm db:migrate >/dev/null

node apps/api/dist/main.js & API_PID=$!
node apps/worker/dist/main.js & WORKER_PID=$!
trap 'kill $API_PID $WORKER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -sf "$API/health/ready" >/dev/null && break
  sleep 0.2
done

step() { echo; echo "==> $1"; }

step "Create organization"
ORG_ID=$(curl -sf -X POST "$API/v1/organizations" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"Demo Vertical Slice Co"}' | node -p 'JSON.parse(require("fs").readFileSync(0)).id')
echo "organization: $ORG_ID"
ORG="x-organization-id: $ORG_ID"

step "Create property and floor"
PROPERTY_ID=$(curl -sf -X POST "$API/v1/properties" -H "$AUTH" -H "$ORG" -H 'content-type: application/json' \
  -d '{"name":"Demo Residence","city":"Springfield"}' | node -p 'JSON.parse(require("fs").readFileSync(0)).id')
FLOOR_ID=$(curl -sf -X POST "$API/v1/properties/$PROPERTY_ID/floors" -H "$AUTH" -H "$ORG" -H 'content-type: application/json' \
  -d '{"name":"First Floor","ordinal":0}' | node -p 'JSON.parse(require("fs").readFileSync(0)).id')
echo "property: $PROPERTY_ID  floor: $FLOOR_ID"

step "Create scan session (idempotent)"
SESSION_ID=$(curl -sf -X POST "$API/v1/scan-sessions" -H "$AUTH" -H "$ORG" -H 'content-type: application/json' \
  -H "idempotency-key: demo-$(date +%s)" \
  -d "{\"propertyId\":\"$PROPERTY_ID\",\"floorId\":\"$FLOOR_ID\",\"requestedOutputs\":[\"normalized_json\"]}" \
  | node -p 'JSON.parse(require("fs").readFileSync(0)).id')
echo "scan session: $SESSION_ID"

step "Issue and redeem handoff deep link"
HANDOFF=$(curl -sf -X POST "$API/v1/scan-sessions/$SESSION_ID/handoff-token" -H "$AUTH" -H "$ORG")
echo "$HANDOFF" | node -p 'const h=JSON.parse(require("fs").readFileSync(0)); `deep link: ${h.deepLinkUrl.slice(0,40)}… (expires ${h.expiresAt})`'
TOKEN=$(echo "$HANDOFF" | node -p 'JSON.parse(require("fs").readFileSync(0)).token')
curl -sf -X POST "$API/v1/scan-handoff/redeem" -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\"}" >/dev/null
echo "handoff redeemed (single-use)"

step "Walk capture state machine and upload fixture bundle"
for T in '{"from":"draft","to":"capturing"}' '{"from":"capturing","to":"local_review"}' \
         '{"from":"local_review","to":"queued_upload"}' '{"from":"queued_upload","to":"uploading"}'; do
  curl -sf -X POST "$API/v1/scan-sessions/$SESSION_ID/status" -H "$AUTH" -H "$ORG" \
    -H 'content-type: application/json' -d "$T" >/dev/null
done

node scripts/build-demo-bundle.mjs "$SESSION_ID"
CAPTURE_ID=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).captureId')
BYTES=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).byteSize')
SHA=$(node -p 'JSON.parse(require("fs").readFileSync(".local/demo-bundle.meta.json")).sha256')

UPLOAD=$(curl -sf -X POST "$API/v1/scan-sessions/$SESSION_ID/uploads" -H "$AUTH" -H "$ORG" -H 'content-type: application/json' \
  -d "{\"captureId\":\"$CAPTURE_ID\",\"byteSize\":$BYTES,\"contentType\":\"application/zip\"}")
UPLOAD_ID=$(echo "$UPLOAD" | node -p 'JSON.parse(require("fs").readFileSync(0)).uploadId')
UPLOAD_URL=$(echo "$UPLOAD" | node -p 'JSON.parse(require("fs").readFileSync(0)).uploadUrl')
curl -sf -X PUT "$UPLOAD_URL" -H "$AUTH" -H "$ORG" -H 'content-type: application/zip' \
  --data-binary @.local/demo-bundle.zip >/dev/null
curl -sf -X POST "$API/v1/scan-sessions/$SESSION_ID/uploads/$UPLOAD_ID/complete" -H "$AUTH" -H "$ORG" \
  -H 'content-type: application/json' -d "{\"sha256\":\"$SHA\",\"byteSize\":$BYTES}" >/dev/null
echo "bundle uploaded and checksum-verified ($BYTES bytes)"

step "Complete session — import job queued"
curl -sf -X POST "$API/v1/scan-sessions/$SESSION_ID/complete" -H "$AUTH" -H "$ORG" >/dev/null

step "Wait for worker import"
PLAN_ID=""
for _ in $(seq 1 60); do
  SESSION=$(curl -sf "$API/v1/scan-sessions/$SESSION_ID" -H "$AUTH" -H "$ORG")
  STATUS=$(echo "$SESSION" | node -p 'JSON.parse(require("fs").readFileSync(0)).status')
  if [ "$STATUS" = "needs_review" ]; then
    PLAN_ID=$(echo "$SESSION" | node -p 'JSON.parse(require("fs").readFileSync(0)).planId')
    break
  fi
  if [ "$STATUS" = "failed" ]; then
    echo "import FAILED:"; echo "$SESSION" | node -p 'JSON.parse(require("fs").readFileSync(0)).failureReason'
    exit 1
  fi
  sleep 0.5
done
[ -n "$PLAN_ID" ] || { echo "timed out waiting for import"; exit 1; }
echo "session needs_review; plan: $PLAN_ID"

step "Normalized plan stub (explicit not_processed fields)"
curl -sf "$API/v1/plans/$PLAN_ID" -H "$AUTH" -H "$ORG" | node -e '
const plan = JSON.parse(require("fs").readFileSync(0));
const p = plan.currentRevision.payload;
console.log(JSON.stringify({
  revision: { id: plan.currentRevisionId, status: plan.currentRevision.status, version: plan.currentRevision.version },
  coordinateConventions: p.coordinateConventions,
  rooms: p.rooms,
  validationFindings: p.validationFindings
}, null, 2));
'

echo
echo "Vertical slice complete."
