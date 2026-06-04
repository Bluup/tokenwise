import { describe, it, expect } from 'vitest';
import { buildAggregate, filterSince, isoDay } from './aggregate.js';
import { buildPayload } from './privacy.js';
import { computeEfficiency } from './efficiency.js';
import type { CostedEvent, GitStats } from './types.js';

function costed(partial: Partial<CostedEvent>): CostedEvent {
  return {
    source: 'claude-code',
    model: 'claude-sonnet-4-6',
    timestamp: '2026-06-01T12:00:00.000Z',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUSD: null,
    cwd: '/Users/jane/secret-project',
    cost: 0,
    costFrom: 'computed',
    ...partial,
  };
}

describe('buildAggregate', () => {
  it('sums cost and tokens and computes the date window', () => {
    const agg = buildAggregate([
      costed({ timestamp: '2026-06-01T00:00:00Z', cost: 1, inputTokens: 100 }),
      costed({ timestamp: '2026-06-03T00:00:00Z', cost: 2, outputTokens: 50 }),
    ]);
    expect(agg.events).toBe(2);
    expect(agg.totalCost).toBe(3);
    expect(agg.inputTokens).toBe(100);
    expect(agg.outputTokens).toBe(50);
    expect(agg.from).toBe('2026-06-01');
    expect(agg.to).toBe('2026-06-03');
    expect(agg.byDay['2026-06-01']).toBe(1);
    expect(agg.byDay['2026-06-03']).toBe(2);
  });

  it('computes cache hit rate as read / (read + creation + input)', () => {
    const agg = buildAggregate([
      costed({ inputTokens: 100, cacheCreationTokens: 100, cacheReadTokens: 200 }),
    ]);
    expect(agg.cacheHitRate).toBeCloseTo(200 / 400, 6);
  });

  it('rolls up per model sorted by cost', () => {
    const agg = buildAggregate([
      costed({ model: 'claude-haiku-4-5', cost: 1 }),
      costed({ model: 'claude-opus-4-8', cost: 5 }),
      costed({ model: 'claude-opus-4-8', cost: 5 }),
    ]);
    expect(agg.byModel[0]?.model).toBe('claude-opus-4-8');
    expect(agg.byModel[0]?.cost).toBe(10);
    expect(agg.byModel[0]?.events).toBe(2);
  });

  it('handles the empty case without NaN', () => {
    const agg = buildAggregate([]);
    expect(agg.events).toBe(0);
    expect(agg.totalCost).toBe(0);
    expect(agg.cacheHitRate).toBe(0);
    expect(agg.from).toBeNull();
  });
});

describe('filterSince', () => {
  it('keeps only events on/after the cutoff day', () => {
    const events = [
      costed({ timestamp: '2026-05-01T00:00:00Z' }),
      costed({ timestamp: '2026-06-10T00:00:00Z' }),
    ];
    expect(filterSince(events, '2026-06-01')).toHaveLength(1);
    expect(filterSince(events, null)).toHaveLength(2);
  });

  it('isoDay extracts the UTC date', () => {
    expect(isoDay('2026-06-10T23:59:00.000Z')).toBe('2026-06-10');
  });
});

describe('buildPayload — privacy', () => {
  const git: GitStats = {
    available: true,
    repo: '/Users/jane/secret-project',
    commits: 10,
    linesAdded: 1000,
    linesDeleted: 200,
  };

  it('never leaks cwd, prompts, or raw repo path', () => {
    const agg = buildAggregate([costed({ cost: 5, cwd: '/Users/jane/secret-project' })]);
    const eff = computeEfficiency(agg, git);
    const payload = buildPayload(agg, eff, git, { clientVersion: '0.1.0', days: 30, now: new Date('2026-06-10T00:00:00Z') });
    const json = JSON.stringify(payload);
    expect(json).not.toContain('secret-project');
    expect(json).not.toContain('/Users/jane');
    // The repo path is present only as a one-way hash.
    expect(payload.projectId).toMatch(/^[0-9a-f]{12}$/);
    expect(payload.projectId).not.toContain('secret');
  });

  it('rounds money to cents', () => {
    const agg = buildAggregate([costed({ cost: 1.23456 })]);
    const eff = computeEfficiency(agg, git);
    const payload = buildPayload(agg, eff, git, { clientVersion: '0.1.0', days: 30 });
    expect(payload.aggregate.totalCost).toBe(1.23);
  });
});

describe('computeEfficiency', () => {
  const noGit: GitStats = { available: false, repo: null, commits: 0, linesAdded: 0, linesDeleted: 0 };

  it('rewards low cost per commit', () => {
    const cheap = buildAggregate([costed({ cost: 1 })]);
    const expensive = buildAggregate([costed({ cost: 50 })]);
    const git = (c: number): GitStats => ({ available: true, repo: '/r', commits: c, linesAdded: 500, linesDeleted: 0 });
    const cheapScore = computeEfficiency(cheap, git(10)).score; // $0.10/commit
    const pricyScore = computeEfficiency(expensive, git(10)).score; // $5/commit
    expect(cheapScore).toBeGreaterThan(pricyScore);
  });

  it('stays within 1..100 and never NaN without git', () => {
    const agg = buildAggregate([costed({ cost: 5, cacheReadTokens: 100, inputTokens: 100 })]);
    const eff = computeEfficiency(agg, noGit);
    expect(eff.score).toBeGreaterThanOrEqual(1);
    expect(eff.score).toBeLessThanOrEqual(100);
    expect(eff.costPerCommit).toBeNull();
  });
});
