// Compute field-validation statistics from docs/testing/field-validation.csv.
// Usage: node scripts/field-stats.mjs [csvPath]
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "docs/testing/field-validation.csv";
const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
const headers = lines[0].split(",");
const rows = lines
  .slice(1)
  .map((line) => Object.fromEntries(line.split(",").map((v, i) => [headers[i], v.trim()])))
  .filter((r) => r.property && !r.property.startsWith("EXAMPLE"));

if (rows.length === 0) {
  console.error("No data rows yet (the EXAMPLE row is ignored). Fill in real measurements first.");
  process.exit(1);
}

const num = (v) => (v === "" || v === undefined ? null : Number(v));
const abs = (a, b) => (a === null || b === null ? null : Math.abs(a - b));
const quantile = (values, q) => {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const idx = Math.min(s.length - 1, Math.ceil(q * s.length) - 1);
  return s[Math.max(0, idx)];
};
const fmt = (v) => (v === null ? "n/a" : `${v.toFixed(2)} in`);

const measured = rows.filter((r) => r.false_opening !== "yes" && num(r.reference_in) !== null);
const rawErrors = measured.map((r) => abs(num(r.roomplan_in), num(r.reference_in))).filter((e) => e !== null);
const corrErrors = measured.map((r) => abs(num(r.corrected_in), num(r.reference_in))).filter((e) => e !== null);

const real = rows.filter((r) => r.false_opening !== "yes");
const detected = real.filter((r) => r.detected === "yes").length;
const falseOpenings = rows.filter((r) => r.false_opening === "yes").length;
const correctWall = real.filter((r) => r.correct_wall === "yes").length;
const correctionTimes = rows.map((r) => num(r.correction_seconds)).filter((v) => v !== null);
const scanTimes = [...new Set(rows.map((r) => `${r.property}:${r.scan_to_schedule_minutes}`))]
  .map((v) => num(v.split(":")[1]))
  .filter((v) => v !== null);
const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

console.log(`Field validation — ${rows.length} rows across ${new Set(rows.map((r) => r.property)).size} propert(ies)\n`);
console.log("RoomPlan vs reference (absolute error):");
console.log(`  median ${fmt(quantile(rawErrors, 0.5))}   p90 ${fmt(quantile(rawErrors, 0.9))}   max ${fmt(rawErrors.length ? Math.max(...rawErrors) : null)}`);
console.log("Corrected vs reference (absolute error):");
console.log(`  median ${fmt(quantile(corrErrors, 0.5))}   p90 ${fmt(quantile(corrErrors, 0.9))}   max ${fmt(corrErrors.length ? Math.max(...corrErrors) : null)}`);
console.log(`Detection rate:        ${real.length ? ((detected / real.length) * 100).toFixed(1) : "n/a"}% (${detected}/${real.length})`);
console.log(`Correct-wall rate:     ${real.length ? ((correctWall / real.length) * 100).toFixed(1) : "n/a"}%`);
console.log(`False openings:        ${falseOpenings} (${rows.length ? ((falseOpenings / rows.length) * 100).toFixed(1) : 0}% of rows)`);
console.log(`Avg correction time:   ${avg(correctionTimes) === null ? "n/a" : `${avg(correctionTimes).toFixed(0)} s/opening`}`);
console.log(`Avg scan→schedule:     ${avg(scanTimes) === null ? "n/a" : `${avg(scanTimes).toFixed(0)} min`}`);
console.log("\nDo not market a tolerance until several materially different properties are recorded here.");
