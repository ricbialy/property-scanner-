// Build the deterministic fixture bundle for the demo script.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildFixtureBundle } = await import(
  join(root, "packages/roomplan-fixtures/dist/index.js")
);

const sessionId = process.argv[2];
const variant = process.argv[3];
if (!sessionId) {
  console.error("usage: build-demo-bundle.mjs <scanSessionId> [variant]");
  process.exit(1);
}
const { manifest, zip } = buildFixtureBundle(sessionId, variant ? { variant } : {});
mkdirSync(join(root, ".local"), { recursive: true });
writeFileSync(join(root, ".local/demo-bundle.zip"), zip);
writeFileSync(
  join(root, ".local/demo-bundle.meta.json"),
  JSON.stringify({
    captureId: manifest.captureId,
    byteSize: zip.byteLength,
    sha256: createHash("sha256").update(zip).digest("hex")
  })
);
