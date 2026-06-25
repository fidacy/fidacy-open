/**
 * @fidacy/agent/openclaw
 *
 * Thin adapter for OpenClaw, a self-hosted agent application that runs tools and
 * actions (files, browser, code, messages, payments) on the user's behalf. It
 * maps one OpenClaw tool execution to the universal `AgentAction` and guards it
 * with a signed, independently verifiable Fidacy verdict.
 *
 * WIRING POINT
 * ------------
 * Call `beforeAction(a)` from OpenClaw's pre-action / tool-execution hook, i.e.
 * the moment OpenClaw is about to run a tool but has not yet run it. Use the
 * returned verdict to gate the action (block on `deny`, hold on `review`) or to
 * annotate the run with the signed `verdict.riskPayloadJws`. `beforeAction`
 * never throws on a `deny`: the caller decides what to do with the verdict.
 *
 * We deliberately do NOT import any OpenClaw package and add no peer dependency.
 * OpenClaw's exact plugin-hook signature is not pinned here; the action is
 * structurally typed, so the adapter works against whatever shape your hook
 * provides as long as it carries a `tool` (and optionally `args`).
 */
import { FidacyGuard, type FidacyGuardOptions, type AgentAction, type Verdict } from './index.js';

/** A structurally typed OpenClaw tool execution. */
export interface OpenClawAction {
  /** The acting agent; falls back to the guard's default `agent`. */
  agent?: string;
  /** On whose behalf; falls back to the guard's default `principal`. */
  principal?: string;
  /** The tool / action name OpenClaw is about to run. */
  tool: string;
  /** The arguments passed to that tool. */
  args?: unknown;
  [k: string]: unknown;
}

/** Map an OpenClaw action to the universal `AgentAction` (`type: 'tool'`). */
export function toAgentAction(
  a: OpenClawAction,
  defaults: { agent: string; principal: string },
): AgentAction {
  return {
    agent: a.agent ?? defaults.agent,
    principal: a.principal ?? defaults.principal,
    type: 'tool',
    payload: { tool: a.tool, args: a.args },
  };
}

export function createOpenClawGuard(
  opts: FidacyGuardOptions & { agent: string; principal: string },
): {
  beforeAction(a: OpenClawAction): Promise<Verdict>;
} {
  const { agent, principal, ...guardOptions } = opts;
  const guard = new FidacyGuard(guardOptions);
  const defaults = { agent, principal };

  return {
    /**
     * Call before OpenClaw executes a tool / action. Returns the signed verdict;
     * throws nothing on `deny` (the caller decides whether to block or annotate).
     */
    beforeAction(a: OpenClawAction): Promise<Verdict> {
      return guard.check(toAgentAction(a, defaults));
    },
  };
}
