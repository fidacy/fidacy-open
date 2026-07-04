// Conformance runner: proves an implementation reproduces the corpus.
// Runs the reference implementation (../dist) against fixtures.json, fully
// offline (injected JWKS, pinned clock). A port in any language passes by
// consuming the same fixtures.json and matching every expectation.
//
//   node conformance/run.mjs           (from packages/verify)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verifyRiskPayload, FidacyVerificationError } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));

let pass = 0;
let fail = 0;
for (const c of corpus.cases) {
  const opts = { jwks: corpus.jwks, now: new Date(corpus.now) };
  let outcome;
  try {
    const v = await verifyRiskPayload(c.jws, opts);
    outcome = { valid: true, decision: v.claims.decision };
  } catch (err) {
    if (!(err instanceof FidacyVerificationError)) throw err;
    outcome = { valid: false, code: err.code };
  }
  const ok =
    outcome.valid === c.expect.valid &&
    (c.expect.valid ? outcome.decision === c.expect.decision : outcome.code === c.expect.code);
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id}  ->  ${JSON.stringify(outcome)}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${corpus.cases.length} conformant${fail ? "  (NOT COMPATIBLE)" : ""}`);
process.exit(fail ? 1 : 0);
