import type { Fidacy } from '@fidacy/sdk';
import { describe, expect, it } from 'vitest';
import { createHermesGuard, paymentToAgentAction } from '../src/hermes.js';
import { createOpenClawGuard, toAgentAction } from '../src/openclaw.js';
import { type CustomMandateShape, cannedResult, fakeFidacy } from './fixtures.js';

const DEFAULTS = { agent: 'did:web:acme.com#agent-1', principal: 'org_acme' };

describe('OpenClaw adapter', () => {
  it('maps a tool action to AgentAction(type:tool, payload:{tool,args})', () => {
    const action = toAgentAction({ tool: 'fs.write', args: { path: '/tmp/x' } }, DEFAULTS);
    expect(action.type).toBe('tool');
    expect(action.agent).toBe(DEFAULTS.agent);
    expect(action.principal).toBe(DEFAULTS.principal);
    expect(action.payload).toEqual({ tool: 'fs.write', args: { path: '/tmp/x' } });
  });

  it('prefers the per-action agent/principal over defaults', () => {
    const action = toAgentAction(
      { tool: 'fs.write', agent: 'agent-override', principal: 'user_42' },
      DEFAULTS,
    );
    expect(action.agent).toBe('agent-override');
    expect(action.principal).toBe('user_42');
  });

  it('beforeAction guards via the universal custom mandate', async () => {
    const fake = fakeFidacy(cannedResult('approve'));
    const g = createOpenClawGuard({
      apiKey: 'fky_test_unused',
      fidacy: fake as unknown as Fidacy,
      verify: false,
      ...DEFAULTS,
    });
    const verdict = await g.beforeAction({ tool: 'browser.open', args: { url: 'https://x.com' } });
    expect(verdict.decision).toBe('approve');
    const mandate = fake.lastParams?.mandate as CustomMandateShape;
    expect(mandate.kind).toBe('custom');
    expect(mandate.actor_agent).toBe(DEFAULTS.agent);
    expect(mandate.payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('Hermes adapter', () => {
  it('maps a payment to AgentAction(type:payment, payload:{amount,recipient,invoice,memo})', () => {
    const action = paymentToAgentAction(
      {
        amount: { value: 1500, currency: 'sat' },
        recipient: '03abc...',
        invoice: 'lnbc15...',
        memo: 'API access',
      },
      DEFAULTS,
    );
    expect(action.type).toBe('payment');
    expect(action.payload).toEqual({
      amount: { value: 1500, currency: 'sat' },
      recipient: '03abc...',
      invoice: 'lnbc15...',
      memo: 'API access',
    });
  });

  it('beforePayment returns a verdict to gate on (deny)', async () => {
    const fake = fakeFidacy(cannedResult('deny'));
    const g = createHermesGuard({
      apiKey: 'fky_test_unused',
      fidacy: fake as unknown as Fidacy,
      verify: false,
      ...DEFAULTS,
    });
    const verdict = await g.beforePayment({
      amount: { value: 999999, currency: 'sat' },
      invoice: 'lnbc99...',
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.decision).toBe('deny');
    const mandate = fake.lastParams?.mandate as CustomMandateShape;
    expect(mandate.actor_agent).toBe(DEFAULTS.agent);
  });

  it('beforeAction maps a non-payment tool (type:tool)', async () => {
    const fake = fakeFidacy(cannedResult('approve'));
    const g = createHermesGuard({
      apiKey: 'fky_test_unused',
      fidacy: fake as unknown as Fidacy,
      verify: false,
      ...DEFAULTS,
    });
    const verdict = await g.beforeAction({ tool: 'web.search', args: { q: 'fidacy' } });
    expect(verdict.allowed).toBe(true);
  });
});
