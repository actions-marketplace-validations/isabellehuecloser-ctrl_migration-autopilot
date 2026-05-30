/**
 * Prompt/rule regression eval (Phase 3quater).
 * Runs the deterministic rule engine over the golden set and reports
 * precision / recall / F1 at the (case, ruleId) level. Exits non-zero if
 * F1 drops below THRESHOLD so CI can gate prompt/rule changes.
 *
 * Run: npm run evals
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRules } from "../src/rules";
import { parseSqlStatements } from "../src/sql";
import { parseRailsStatements } from "../src/rails";
import type { Migration, Orm, Dialect } from "../src/types";

const THRESHOLD = 0.9; // fail CI if F1 < 0.9

interface Case {
  name: string;
  orm: Orm;
  dialect: Dialect;
  text: string;
  expect: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "golden-set.json"), "utf8")) as { cases: Case[] };

function buildMig(c: Case): Migration {
  return {
    filename: `golden/${c.name}`,
    orm: c.orm,
    dialect: c.dialect,
    addedText: c.text,
    statements: c.orm === "rails" ? parseRailsStatements(c.text) : parseSqlStatements(c.text),
  };
}

let tp = 0;
let fp = 0;
let fn = 0;
const failures: string[] = [];

for (const c of golden.cases) {
  const got = new Set(runRules(buildMig(c)).map((f) => f.ruleId));
  const want = new Set(c.expect);

  for (const id of got) {
    if (want.has(id)) tp++;
    else {
      fp++;
      failures.push(`FALSE POSITIVE  [${c.name}] fired '${id}' (expected: ${[...want].join(", ") || "none"})`);
    }
  }
  for (const id of want) {
    if (!got.has(id)) {
      fn++;
      failures.push(`MISSED          [${c.name}] expected '${id}' but engine stayed silent`);
    }
  }
}

const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

console.log(`\nMigration Autopilot — rule eval`);
console.log(`================================`);
console.log(`cases:      ${golden.cases.length}`);
console.log(`true pos:   ${tp}`);
console.log(`false pos:  ${fp}`);
console.log(`missed:     ${fn}`);
console.log(`precision:  ${(precision * 100).toFixed(1)}%`);
console.log(`recall:     ${(recall * 100).toFixed(1)}%`);
console.log(`F1:         ${(f1 * 100).toFixed(1)}%`);

if (failures.length) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f}`);
}

// Phase 3 acceptance: false positives are unacceptable for a merge-gating tool.
if (fp > 0) {
  console.error(`\n❌ ${fp} false positive(s). A merge-gating tool must have ZERO false positives.`);
  process.exit(1);
}
if (f1 < THRESHOLD) {
  console.error(`\n❌ F1 ${(f1 * 100).toFixed(1)}% < threshold ${(THRESHOLD * 100).toFixed(0)}%.`);
  process.exit(1);
}
console.log(`\n✅ Passed (F1 ${(f1 * 100).toFixed(1)}%, ${fp} false positives).`);
