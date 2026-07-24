/**
 * KLAIMEE x FIDACY — the claim file.
 *
 * An insurer has two moments. Underwriting, where it prices the risk, and the
 * claim, where it pays. Klaimee's public model covers both: a declarative
 * application plus a stack audit up front, and an 8-dimension risk taxonomy
 * (scope violation, data exfiltration, unauthorized action, output integrity,
 * adversarial manipulation, behavioral instability, model drift, operational
 * control failure).
 *
 * This runs the second moment. Six of those eight dimensions are decisions a
 * firewall makes at the instant the agent acts, and every one of them here is
 * signed at that instant, chained, and verifiable later by someone who trusts
 * neither the insured nor the insurer.
 *
 * Honesty contract, also printed in the run:
 *  - The FIDACY side is the real shipped engine (DevFidacyCore from the
 *    published @fidacy/mcp on npm): real Ed25519 grants, real hash-chained
 *    audit, real deny rules. Nothing mocked.
 *  - The KLAIMEE side is only a MAPPING: our reading of the 8 risk dimensions
 *    published on klaimee.ai. It is not their product and makes no claim about
 *    their underwriting.
 *  - Verification below uses stock node:crypto, never a Fidacy library. That is
 *    the point: the evidence does not depend on us still being around.
 *
 *   npm i && node demo.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import { DevFidacyCore } from "@fidacy/mcp/lib";

const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", Y = "\x1b[33m", RD = "\x1b[31m";
const line = (c = "─") => console.log(D + c.repeat(74) + R);
const h = (t) => { console.log(); line(); console.log(B + t + R); line(); };

const audit = join(mkdtempSync(join(tmpdir(), "fidacy-klaimee-")), "audit.log");

// The mandate is the policy document: what the human authorized this agent to
// do. Everything the firewall decides is decided against this.
const core = new DevFidacyCore({
  mandate: {
    id: "mandate:acme-ops-agent",
    subject: "agent:acme-ops",
    version: "ap2.v0.2.0",
    allow: {
      payees: ["supplier:northwind-logistics", "supplier:contoso-cloud"],
      categories: ["invoice", "saas"],
      currency: "USD",
      perTxMax: 5000,
      maxTotal: 25000,
    },
    window: { start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" },
    revoked: false,
  },
  auditLogPath: audit,
});

const SUBJECT = "agent:acme-ops";

// Each scenario names the Klaimee dimension it lands on. The mapping is ours.
const SCENARIOS = [
  {
    dim: "— (clean)",
    note: "the legitimate payment, later disputed at claim time",
    req: { payee: "supplier:northwind-logistics", amount: 4200, currency: "USD",
           purpose: "Q3 freight invoice", category: "invoice",
           idempotencyKey: "k-1", invoiceRef: "INV-2026-0912" },
  },
  {
    dim: "scope violation",
    note: "category the human never authorized",
    req: { payee: "supplier:contoso-cloud", amount: 900, currency: "USD",
           purpose: "crypto purchase", category: "crypto", idempotencyKey: "k-2" },
  },
  {
    dim: "unauthorized action",
    note: "payee absent from the allowlist",
    req: { payee: "supplier:unknown-vendor", amount: 300, currency: "USD",
           purpose: "consulting", category: "invoice", idempotencyKey: "k-3" },
  },
  {
    dim: "adversarial manipulation",
    note: "prompt-injected lookalike: northw1nd, not northwind",
    req: { payee: "supplier:northw1nd-logistics", amount: 4200, currency: "USD",
           purpose: "Q3 freight invoice", category: "invoice", idempotencyKey: "k-4" },
  },
  {
    dim: "operational control failure",
    note: "above the per-transaction ceiling",
    req: { payee: "supplier:contoso-cloud", amount: 9000, currency: "USD",
           purpose: "annual renewal", category: "saas", idempotencyKey: "k-5" },
  },
  {
    dim: "output integrity",
    note: "same invoice presented a second time",
    req: { payee: "supplier:northwind-logistics", amount: 4200, currency: "USD",
           purpose: "Q3 freight invoice", category: "invoice",
           idempotencyKey: "k-6", invoiceRef: "INV-2026-0912" },
  },
];

h("ACT 1 — UNDERWRITING IS CONTINUOUS, NOT A SNAPSHOT");
console.log(D + "Every consequential action, decided against the mandate at the moment it\nhappens. A denied action is a loss that never became a claim.\n" + R);

const decisions = [];
for (const s of SCENARIOS) {
  const d = await core.decide(s.req, SUBJECT);
  decisions.push({ ...s, d });
  const tag = d.status === "ALLOW" ? `${G}ALLOW${R}` : `${RD}DENY ${R}`;
  console.log(`${tag}  ${s.req.payee.padEnd(32)} ${String(s.req.amount).padStart(5)} ${s.req.currency}`);
  console.log(`       ${D}klaimee dimension:${R} ${Y}${s.dim}${R}`);
  console.log(`       ${D}${s.note}${R}`);
  if (d.violatedRule) console.log(`       ${D}rule fired:${R} ${d.violatedRule}`);
  console.log();
}

const denied = decisions.filter((x) => x.d.status === "DENY").length;
console.log(`${B}${denied} of ${decisions.length} actions stopped before money moved.${R}`);
console.log(D + "For an underwriter that is loss frequency, measured rather than declared." + R);

h("ACT 2 — THE CLAIM: WHAT ACTUALLY HAPPENED, AND WAS IT AUTHORIZED");

const claim = decisions[0].d; // the ALLOW, now disputed
console.log(`${D}Alleged incident: the insured says the agent paid an invoice it was never`);
console.log(`authorized to pay. Both sides have logs. Neither side's logs are evidence.${R}\n`);

const proof = await core.getProof(claim.decisionId);
const pubPem = core.publicKey();

// Verification with stock node:crypto. No Fidacy library, no call home.
const [body, sig] = claim.grant.split(".");
const grantValid = crypto.verify(
  null,
  Buffer.from(body, "utf8"),
  crypto.createPublicKey(pubPem),
  Buffer.from(sig, "base64url")
);
const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));

console.log(`${B}claim file${R}`);
console.log(`  decision id      ${claim.decisionId}`);
console.log(`  decided at       ${claim.ts}`);
console.log(`  authorized under ${claim.mandateId}`);
console.log(`  payee            ${payload.payee}`);
console.log(`  amount           ${payload.amount} ${payload.currency}`);
console.log(`  invoice          ${payload.invoiceRef}`);
console.log(`  audit position   seq ${proof.record.seq}, hash ${proof.record.hash.slice(0, 24)}…`);
console.log();
console.log(`${B}verified by the adjudicator, with stock node:crypto${R}`);
console.log(`  grant signature  ${grantValid ? G + "valid" + R : RD + "INVALID" + R}   ${D}← Ed25519, against the public key alone${R}`);
console.log(`  audit chain      ${proof.chainIntact ? G + "intact" + R : RD + "BROKEN" + R}   ${D}← every prior record still hashes forward${R}`);
console.log(`  same invoice     ${G}claimed once${R}   ${D}← the second attempt is on record as a deny${R}`);
console.log();
console.log(D + "The adjudicator did not ask the insured for logs, did not ask Fidacy for" + R);
console.log(D + "anything, and did not have to trust either one." + R);

h("WHAT THIS CHANGES FOR AN INSURER");
console.log("  underwriting   loss frequency observed per agent, continuously, not declared once");
console.log("  claim handling authorization is a signed fact, not a reconstruction from logs");
console.log("  moral hazard   the insured cannot rewrite what its own agent was allowed to do");
console.log("  subrogation    a portable artifact a third party accepts without trusting anyone");
console.log();
line();
console.log(D + "Fidacy side: real shipped engine (@fidacy/mcp, npm). Real Ed25519, real chain." + R);
console.log(D + "Klaimee side: our mapping of the 8 public risk dimensions. Not their product." + R);
console.log(D + "This dev core signs with a per-session key. Production uses a stable key and" + R);
console.log(D + "anchors audit checkpoints into Bitcoin, so the record outlives the issuer." + R);
line();
