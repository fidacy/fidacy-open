/**
 * @fidacy/agent/hermes
 *
 * Thin adapter for Hermes Agent (Nous Research), a self-hosted autonomous agent
 * that, notably, PAYS autonomously (L402 / Lightning, on-chain). This adapter
 * focuses on sealing those payments (and other actions) with a signed,
 * independently verifiable Fidacy verdict: who authorized it, and the action's
 * provenance.
 *
 * WIRING POINT
 * ------------
 * Call `beforePayment(p)` right before Hermes settles an L402 invoice or sends a
 * Lightning / on-chain payment, and gate on `verdict.allowed`. Every autonomous
 * payment then carries a signed, verifiable authorization seal
 * (`verdict.riskPayloadJws`) that anyone can re-check against Fidacy's public
 * JWKS. Use `beforeAction(a)` for non-payment Hermes tools.
 *
 * We deliberately do NOT import any Hermes package and add no peer dependency.
 * Hermes' exact tool / payment-hook signature is not pinned here; the payment is
 * structurally typed, so the adapter works against whatever shape your hook
 * provides.
 */
import { FidacyGuard, type FidacyGuardOptions, type AgentAction, type Verdict } from './index.js';

/** A structurally typed Hermes payment (L402 / Lightning / on-chain). */
export interface HermesPayment {
  /** The acting agent; falls back to the guard's default `agent`. */
  agent?: string;
  /** On whose behalf; falls back to the guard's default `principal`. */
  principal?: string;
  /** The amount being paid. */
  amount?: { value: number; currency: string };
  /** The payee (node pubkey / address / handle). */
  recipient?: string;
  /** The L402 / Lightning invoice being settled. */
  invoice?: string;
  /** Optional human memo. */
  memo?: string;
  [k: string]: unknown;
}

/** Map a Hermes payment to the universal `AgentAction` (`type: 'payment'`). */
export function paymentToAgentAction(
  p: HermesPayment,
  defaults: { agent: string; principal: string },
): AgentAction {
  return {
    agent: p.agent ?? defaults.agent,
    principal: p.principal ?? defaults.principal,
    type: 'payment',
    payload: {
      amount: p.amount,
      recipient: p.recipient,
      invoice: p.invoice,
      memo: p.memo,
    },
  };
}

/** A structurally typed Hermes non-payment tool action. */
export interface HermesAction {
  tool: string;
  args?: unknown;
  agent?: string;
  principal?: string;
}

function actionToAgentAction(
  a: HermesAction,
  defaults: { agent: string; principal: string },
): AgentAction {
  return {
    agent: a.agent ?? defaults.agent,
    principal: a.principal ?? defaults.principal,
    type: 'tool',
    payload: { tool: a.tool, args: a.args },
  };
}

export function createHermesGuard(
  opts: FidacyGuardOptions & { agent: string; principal: string },
): {
  beforePayment(p: HermesPayment): Promise<Verdict>;
  beforeAction(a: HermesAction): Promise<Verdict>;
} {
  const { agent, principal, ...guardOptions } = opts;
  const guard = new FidacyGuard(guardOptions);
  const defaults = { agent, principal };

  return {
    /**
     * Call before Hermes settles an L402 invoice / sends a payment. Returns the
     * signed verdict; gate on `verdict.allowed`.
     */
    beforePayment(p: HermesPayment): Promise<Verdict> {
      return guard.check(paymentToAgentAction(p, defaults));
    },
    /** Generic Hermes action (non-payment tool) guard. */
    beforeAction(a: HermesAction): Promise<Verdict> {
      return guard.check(actionToAgentAction(a, defaults));
    },
  };
}
