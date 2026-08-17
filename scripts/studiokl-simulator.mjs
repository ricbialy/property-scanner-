// StudioKL integration simulator.
//
// Plays the role of StudioKL's server: receives signed Property Scan webhooks,
// verifies the HMAC signature and replay window, deduplicates by event id, and
// on plan.accepted pulls the window/door schedules through the public API —
// exactly what the real StudioKL adapter will do. Imported data is written to
// .local/studiokl-import.json for inspection. Nothing here touches Property
// Scan's database directly.
//
// Env: SIMULATOR_PORT (4300), WEBHOOK_SECRET, API_BASE_URL, PS_TOKEN, PS_ORG
import { createServer } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { verifyWebhookSignature, SIGNATURE_HEADER } = await import(
  join(root, "integrations/studiokl/dist/index.js")
);

const port = Number(process.env.SIMULATOR_PORT ?? 4300);
const secret = process.env.WEBHOOK_SECRET ?? "studiokl-simulator-secret-0001";
const apiBase = process.env.API_BASE_URL ?? "http://localhost:4100";
const token = process.env.PS_TOKEN ?? "dev_user_demo_owner";
const org = process.env.PS_ORG ?? "";

const seenEventIds = new Set();
const imported = [];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const signature = req.headers[SIGNATURE_HEADER] ?? "";
    const verdict = verifyWebhookSignature(body, String(signature), {
      secretsByKeyId: { k1: secret }
    });
    if (!verdict.ok) {
      console.error(`[studiokl-sim] REJECTED webhook: ${verdict.reason}`);
      res.writeHead(401).end();
      return;
    }
    const envelope = JSON.parse(body);
    if (seenEventIds.has(envelope.eventId)) {
      console.error(`[studiokl-sim] duplicate event ${envelope.eventId} — acknowledged, ignored`);
      res.writeHead(200).end();
      return;
    }
    seenEventIds.add(envelope.eventId);
    console.error(`[studiokl-sim] received ${envelope.eventType} (${envelope.eventId})`);

    if (envelope.eventType === "plan.accepted") {
      try {
        const headers = { authorization: `Bearer ${token}`, "x-organization-id": org };
        const planId = envelope.payload.planId;
        const [windows, doors] = await Promise.all([
          fetch(`${apiBase}/v1/plans/${planId}/schedules/windows`, { headers }).then((r) => r.json()),
          fetch(`${apiBase}/v1/plans/${planId}/schedules/doors`, { headers }).then((r) => r.json())
        ]);
        imported.push({
          eventId: envelope.eventId,
          planId,
          revisionId: envelope.payload.revisionId,
          importedAt: new Date().toISOString(),
          windows: windows.data,
          doors: doors.data,
          needsHumanReview: [...(windows.data ?? []), ...(doors.data ?? [])].filter(
            (o) => o.verification !== "field_verified"
          ).length
        });
        mkdirSync(join(root, ".local"), { recursive: true });
        writeFileSync(
          join(root, ".local/studiokl-import.json"),
          JSON.stringify(imported, null, 2)
        );
        console.error(
          `[studiokl-sim] imported plan ${planId}: ${windows.data?.length ?? 0} windows, ${doors.data?.length ?? 0} doors -> .local/studiokl-import.json`
        );
      } catch (error) {
        console.error(`[studiokl-sim] import failed: ${error.message}`);
      }
    }
    res.writeHead(200).end(JSON.stringify({ received: true }));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.error(`[studiokl-sim] listening on http://127.0.0.1:${port} (org ${org || "unset"})`);
});
