#!/usr/bin/env python3
"""
Fidacy quickstart (Python) — "don't trust us, verify".

  1. Assess a payment mandate (the engine validates, scores, signs, audits).
  2. Verify the signed verdict YOURSELF against the public JWKS — no trust needed.

Run (30 seconds):
  pip install requests "PyJWT[crypto]"
  FIDACY_API_KEY=fky_test_…  python3 quickstart.py      # test key from app.fidacy.com
"""
import os
import sys
import uuid

import requests
import jwt
from jwt import PyJWK

API = "https://api.fidacy.com"
api_key = os.environ.get("FIDACY_API_KEY")
if not api_key:
    sys.exit(
        "\n  ✗ Set FIDACY_API_KEY first."
        "\n    Create a TEST key (sandbox, never billed) at https://app.fidacy.com → API Keys → mode: test"
        "\n    Then:  FIDACY_API_KEY=fky_test_… python3 quickstart.py\n"
    )

mandate = {
    "vct": "mandate.payment.1",
    "transaction_id": uuid.uuid4().hex,
    "payee": {"id": "merchant_demo", "name": "Demo Store"},
    "payment_amount": {"amount": 4299, "currency": "EUR"},
    "payment_instrument": {"id": "pi_demo", "type": "card"},
}

# 1) Assess — returns the decision + an EdDSA-signed verdict (riskPayloadJws).
verdict = requests.post(
    f"{API}/v1/assess",
    headers={"x-api-key": api_key, "content-type": "application/json"},
    json={"mandate": mandate, "kind": "ap2_payment"},
    timeout=30,
).json()
print(f"\n  decision  : {verdict['decision']}  (approve | review | deny)")
print(f"  score     : {verdict['score']}")
print(f"  assessment: {verdict['assessmentId']}")

# 2) Verify the signature yourself, against the public JWKS — offline-checkable, no trust.
jws = verdict["riskPayloadJws"]
jwks = requests.get(f"{API}/.well-known/jwks.json", timeout=15).json()
kid = jwt.get_unverified_header(jws)["kid"]
jwk = next(k for k in jwks["keys"] if k["kid"] == kid)
public_key = PyJWK.from_dict(jwk).key  # OKP / Ed25519
# EdDSA lock: jwt.decode raises if the signature is invalid OR the alg isn't EdDSA.
claims = jwt.decode(
    jws, public_key, algorithms=["EdDSA"],
    options={"verify_aud": False, "verify_exp": False, "verify_iat": False, "verify_nbf": False},
)
print("\n  signature valid : True   ← anyone (a rail, an auditor, a public body) can check this")
print(f"  signed decision : {claims.get('decision')} (matches the response: {claims.get('decision') == verdict['decision']})\n")
