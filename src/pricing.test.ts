import { describe, it, expect } from 'vitest';
import { priceFor, computeCostFromTokens, costEvent } from './pricing.js';
import type { UsageEvent } from './types.js';

function ev(partial: Partial<UsageEvent>): UsageEvent {
  return {
    source: 'claude-code',
    model: 'claude-sonnet-4-6',
    timestamp: '2026-06-01T00:00:00.000Z',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUSD: null,
    cwd: null,
    ...partial,
  };
}

describe('priceFor', () => {
  it('matches model families by substring', () => {
    expect(priceFor('claude-opus-4-8').input).toBe(15);
    expect(priceFor('claude-sonnet-4-6').input).toBe(3);
    expect(priceFor('claude-haiku-4-5').input).toBe(0.8);
    expect(priceFor('gpt-5-codex').input).toBe(1.25);
    expect(priceFor('gpt-5-mini').input).toBe(0.25); // specific before generic gpt-5
  });

  it('falls back for unknown models', () => {
    expect(priceFor('some-future-model').input).toBe(3);
  });
});

describe('computeCostFromTokens', () => {
  it('prices each token bucket at its own rate', () => {
    // sonnet: input 3, output 15, cacheWrite 3.75, cacheRead 0.30 per million
    const cost = computeCostFromTokens(
      ev({
        model: 'claude-sonnet-4-6',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      }),
    );
    expect(cost).toBeCloseTo(3 + 15 + 3.75 + 0.3, 6);
  });

  it('handles realistic cache-heavy turns', () => {
    // 3 input, 168 output, 23064 cache-creation, 0 cache-read (real sample)
    const cost = computeCostFromTokens(
      ev({ inputTokens: 3, outputTokens: 168, cacheCreationTokens: 23064 }),
    );
    const expected = (3 * 3 + 168 * 15 + 23064 * 3.75) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 9);
  });

  it('is zero when there are no tokens', () => {
    expect(computeCostFromTokens(ev({}))).toBe(0);
  });
});

describe('costEvent', () => {
  it('prefers reported costUSD when present and valid', () => {
    const result = costEvent(ev({ costUSD: 0.42, inputTokens: 1_000_000 }));
    expect(result.cost).toBe(0.42);
    expect(result.costFrom).toBe('reported');
  });

  it('computes from tokens when costUSD is null (the Claude Code case)', () => {
    const result = costEvent(ev({ costUSD: null, outputTokens: 1_000_000 }));
    expect(result.cost).toBeCloseTo(15, 6);
    expect(result.costFrom).toBe('computed');
  });

  it('ignores negative / non-finite reported costs and recomputes', () => {
    expect(costEvent(ev({ costUSD: -1, outputTokens: 1_000_000 })).costFrom).toBe('computed');
    expect(costEvent(ev({ costUSD: Number.NaN, outputTokens: 1_000_000 })).costFrom).toBe('computed');
  });
});
