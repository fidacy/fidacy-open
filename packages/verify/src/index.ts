/**
 * @fidacy/verify
 *
 * Isomorphic signature verification for Fidacy signed payloads, against
 * Fidacy's public JWKS. Runs in Node 18+, the browser, and edge runtimes.
 *
 * This package only verifies signatures and contains no Fidacy proprietary
 * logic. It never imports private/engine code.
 */

export const VERSION = '0.0.0';

// TODO Slice 2: verifyRiskPayload, verifyWebhook
