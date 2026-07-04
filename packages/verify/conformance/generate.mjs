// One-time fixture generator for the conformance corpus. Signs real JWS values
// with a THROWAWAY Ed25519 keypair (the private key is discarded; only the
// public JWKS ships in fixtures.json). Re-running regenerates every fixture,
// so ports never depend on a specific historical byte string, only on the
// (fixtures, expectations) contract.
//
//   node conformance/generate.mjs > conformance/fixtures.json
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const NOW = "2026-07-04T12:00:00.000Z";
const KID = "conformance-2026-07";
const ISSUER = `did:web:fidacy.com#${KID}`;

const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
const pubJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "EdDSA", use: "sig" };

// A second, UNPUBLISHED key: signatures from it must fail as unknown_kid.
const rogue = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });

const baseClaims = {
  issuer: ISSUER,
  subject: "agent:conformance",
  decision: "approve",
  score: 12,
  signals: { conformance: true },
  model_version: "fidacy-risk-0.1.0",
  assessed_at: NOW,
};

async function sign(claims, key = privateKey, kid = KID) {
  return new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid, typ: "fidacy-risk+jws" }).sign(key);
}

function tamper(jws) {
  // Flip the payload (middle) segment: signature no longer matches.
  const [h, p, s] = jws.split(".");
  const decoded = Buffer.from(p, "base64url").toString("utf8").replace('"approve"', '"deny"   ');
  return [h, Buffer.from(decoded, "utf8").toString("base64url"), s].join(".");
}

const cases = [
  { id: "valid_approve", jws: await sign(baseClaims), expect: { valid: true, decision: "approve" } },
  { id: "valid_deny", jws: await sign({ ...baseClaims, decision: "deny", score: 91 }), expect: { valid: true, decision: "deny" } },
  { id: "tampered_payload", jws: tamper(await sign(baseClaims)), expect: { valid: false, code: "invalid_signature" } },
  { id: "unknown_kid", jws: await sign(baseClaims, rogue.privateKey, "not-in-jwks"), expect: { valid: false, code: "unknown_kid" } },
  { id: "wrong_issuer", jws: await sign({ ...baseClaims, issuer: "did:web:attacker.example#k1" }), expect: { valid: false, code: "wrong_issuer" } },
  { id: "expired", jws: await new SignJWT(baseClaims).setProtectedHeader({ alg: "EdDSA", kid: KID }).setExpirationTime(new Date("2026-07-04T11:00:00.000Z")).sign(privateKey), expect: { valid: false, code: "expired" } },
  { id: "missing_required_claim", jws: await sign((({ decision, ...rest }) => rest)(baseClaims)), expect: { valid: false, code: "malformed" } },
  { id: "not_a_jws", jws: "definitely.not-a-valid", expect: { valid: false, code: "malformed" } },
];

process.stdout.write(
  JSON.stringify(
    {
      v: "fidacy-verify-conformance.v1",
      description:
        "Conformance corpus for ports of @fidacy/verify. Verify each case offline against the embedded jwks with now pinned to the given instant; a compatible implementation reproduces every expectation. The signing key is throwaway and unpublished.",
      now: NOW,
      issuerPrefix: "did:web:fidacy.com#",
      jwks: { keys: [pubJwk] },
      cases,
    },
    null,
    2,
  ) + "\n",
);
