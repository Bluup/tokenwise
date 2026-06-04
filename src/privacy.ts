import { createHash } from 'node:crypto';
import type { Aggregate, Efficiency, GitStats } from './types.js';

export const SCHEMA_VERSION = 'tw.aggregate.v1';

/** The exact shape uploaded to the hosted API. Numbers + hashes only. */
export interface UploadPayload {
  schema: string;
  client: string;
  /** Opt-in public handle for the leaderboard. */
  handle: string;
  generatedAt: string;
  window: { from: string | null; to: string | null; days: number | null };
  /** SHA-256 (first 12 hex) of the repo path — never the path itself. */
  projectId: string | null;
  aggregate: {
    events: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cacheHitRate: number;
    byModel: Array<{ model: string; source: string; events: number; cost: number }>;
    bySource: Partial<Record<string, number>>;
    byDay: Record<string, number>;
  };
  efficiency: {
    score: number;
    costPerCommit: number | null;
    costPerKLoc: number | null;
    cacheHitRate: number;
  };
  shipped: { commits: number; linesAdded: number; linesDeleted: number };
}

function hashPath(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 12);
}

/** Round money to cents and rates to 4 decimals so the payload is clean. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}
function rate(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Build the upload-safe payload. By construction it cannot contain prompts,
 * code, file paths, branch names, or absolute project paths — only counts,
 * costs, and a one-way hash of the repo location.
 */
export function buildPayload(
  agg: Aggregate,
  eff: Efficiency,
  git: GitStats,
  opts: { clientVersion: string; days: number | null; handle?: string; now?: Date },
): UploadPayload {
  const now = opts.now ?? new Date();
  return {
    schema: SCHEMA_VERSION,
    client: `tokenwise-cli/${opts.clientVersion}`,
    handle: opts.handle ?? '@you',
    generatedAt: now.toISOString(),
    window: { from: agg.from, to: agg.to, days: opts.days },
    projectId: git.repo ? hashPath(git.repo) : null,
    aggregate: {
      events: agg.events,
      totalCost: money(agg.totalCost),
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      cacheCreationTokens: agg.cacheCreationTokens,
      cacheReadTokens: agg.cacheReadTokens,
      cacheHitRate: rate(agg.cacheHitRate),
      byModel: agg.byModel.map((m) => ({
        model: m.model,
        source: m.source,
        events: m.events,
        cost: money(m.cost),
      })),
      bySource: Object.fromEntries(
        Object.entries(agg.bySource).map(([k, v]) => [k, money(v ?? 0)]),
      ),
      byDay: Object.fromEntries(
        Object.entries(agg.byDay).map(([k, v]) => [k, money(v)]),
      ),
    },
    efficiency: {
      score: eff.score,
      costPerCommit: eff.costPerCommit === null ? null : money(eff.costPerCommit),
      costPerKLoc: eff.costPerKLoc === null ? null : money(eff.costPerKLoc),
      cacheHitRate: rate(eff.cacheHitRate),
    },
    shipped: {
      commits: git.commits,
      linesAdded: git.linesAdded,
      linesDeleted: git.linesDeleted,
    },
  };
}
