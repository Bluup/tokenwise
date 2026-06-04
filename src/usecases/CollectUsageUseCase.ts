import type { Aggregate, Efficiency, GitStats, UsageEvent } from '../types.js';
import { costEvent } from '../pricing.js';
import { buildAggregate, filterSince, daysAgo } from '../aggregate.js';
import { computeEfficiency } from '../efficiency.js';

export interface Report {
  aggregate: Aggregate;
  efficiency: Efficiency;
  git: GitStats;
  days: number | null;
  /** Whether each source contributed any events. */
  sources: { claudeCode: number; codex: number };
}

export interface CollectDeps {
  collectClaudeCode: () => UsageEvent[];
  collectCodex: () => UsageEvent[];
  gitStats: (cwd: string, sinceDay: string | null) => GitStats;
  cwd: string;
  now?: Date;
}

/**
 * Orchestrates the local pipeline: collect raw usage from every source, resolve
 * cost per event, window it, aggregate, then estimate efficiency against local
 * git activity. Pure given its injected deps (testable without disk/git).
 */
export class CollectUsageUseCase {
  constructor(private deps: CollectDeps) {}

  execute(input: { days: number | null }): Report {
    const { days } = input;
    const now = this.deps.now ?? new Date();
    const sinceDay = days === null ? null : daysAgo(days, now);

    const claude = this.deps.collectClaudeCode();
    const codex = this.deps.collectCodex();
    const costed = filterSince([...claude, ...codex].map(costEvent), sinceDay);

    const aggregate = buildAggregate(costed);
    const git = this.deps.gitStats(this.deps.cwd, sinceDay);
    const efficiency = computeEfficiency(aggregate, git);

    return {
      aggregate,
      efficiency,
      git,
      days,
      sources: {
        claudeCode: costed.filter((e) => e.source === 'claude-code').length,
        codex: costed.filter((e) => e.source === 'codex').length,
      },
    };
  }
}
