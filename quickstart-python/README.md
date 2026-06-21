# Fidacy quickstart — Python

Assess a payment mandate, then verify the signed verdict yourself — no trust required.

```bash
pip install -r requirements.txt          # requests + PyJWT[crypto]
FIDACY_API_KEY=fky_test_…  python3 quickstart.py
```

Get a **test** key (sandbox, never billed) at https://app.fidacy.com → API Keys → mode: test.

Output: a signed verdict and `signature valid: True`, verified against the public JWKS
(`https://api.fidacy.com/.well-known/jwks.json`) with an EdDSA algorithm lock — entirely
client-side. Drop the verify step into your own audit pipeline; a counterparty (a payment
rail, an auditor, a public body) can check any Fidacy decision without taking your word.
