#!/usr/bin/env node
/**
 * Ground-truth validator for the Model Watch battery. For every scenario, feed
 * its canonical action (baits.mjs) to the REAL @fidacy/firewall in battery order
 * and assert the firewall's verdict equals the scenario's declared
 * expected_firewall. This proves the labels against the production engine rather
 * than trusting a hand-written table. Run in CI; a mismatch fails the build.
 */
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BAIT, CORRECT } from "./baits.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The deterministic judge, from npm: the exact DevFidacyCore inlined in the
// published @fidacy/mcp bundle. npm i inside this folder and every number
// reproduces without any private repository.
const { DevFidacyCore } = await import("@fidacy/mcp/core");

const battery = JSON.parse(readFileSync(join(HERE, "scenarios.json"), "utf8"));

function resultOf(status, rule) {
  if (status === "ALLOW") return "allow";
  const r = rule ?? "";
  if (r.startsWith("payee_lookalike")) return "deny_lookalike";
  if (r.startsWith("payee_not_in_allowlist")) return "deny_payee";
  if (r.startsWith("duplicate_invoice")) return "deny_duplicate";
  if (r.startsWith("per_tx_cap") || r.startsWith("total_cap")) return "deny_cap";
  if (r.startsWith("mandate_revoked") || r.startsWith("before_mandate") || r.startsWith("after_mandate")) return "deny_window";
  if (r.startsWith("non_positive_amount") || r.startsWith("invalid_")) return "deny_invalid";
  return "deny_scope";
}

const m = battery.mandate;
const mandate = {
  id: "mandate:bench", subject: "agent:bench", version: "ap2.v0.2.0",
  allow: { payees: m.payees, categories: m.categories, currency: m.currency, maxTotal: m.maxTotal, perTxMax: m.perTxMax },
  window: { notBefore: new Date(Date.now() - 3600_000).toISOString(), notAfter: new Date(Date.now() + 30 * 86400_000).toISOString() },
  revoked: false,
};
const auditPath = join(HERE, ".audit", "validate.log");
mkdirSync(dirname(auditPath), { recursive: true });
rmSync(auditPath, { force: true });
const core = new DevFidacyCore({ mandate, auditLogPath: auditPath });

let pass = 0, fail = 0, missing = 0;
for (const sc of battery.scenarios) {
  const action = sc.adversarial ? BAIT[sc.id] : CORRECT[sc.id];
  if (!action) { console.log(`MISS  ${sc.id} — no canonical action in baits.mjs`); missing++; continue; }
  const d = await core.decide(
    { payee: action.payee, amount: action.amount, currency: action.currency, purpose: "validate", category: action.category, idempotencyKey: `val-${sc.id}`, invoiceRef: action.invoiceRef },
    "agent:bench",
  );
  const got = resultOf(d.status, d.violatedRule);
  if (got === sc.expected_firewall) { pass++; }
  else { fail++; console.log(`FAIL  ${sc.id}: expected ${sc.expected_firewall}, firewall said ${got} (${d.violatedRule ?? d.status})`); }
}

console.log(`\nbattery ground-truth: ${pass} pass, ${fail} fail, ${missing} missing (of ${battery.scenarios.length})`);
process.exit(fail === 0 && missing === 0 ? 0 : 1);
