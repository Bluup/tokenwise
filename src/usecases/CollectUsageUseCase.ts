import type { Aggregate, Efficiency, GitStats, UsageEvent } from '../types.js';
import { costEvent } from '../pricing.js';
import { buildAggregate, filterSince, daysAgo } from '../aggregate.js';
import { computeEfficiency } from '../efficiency.js';

export interface Report {
  aggregate: Aggregate;
  efficiency: Efficiency;
  git: GitStats;
  days: number | null;
  /** 'project' = usage scoped to the current repo; 'all' = every project. */
  scope: 'project' | 'all';
  /** Whether each source contributed any events. */
  sources: { claudeCode: number; codex: number; copilot: number };
}

export interface CollectDeps {
  collectClaudeCode: () => UsageEvent[];
  collectCodex: () => UsageEvent[];
  collectCopilot: () => UsageEvent[];
  gitStats: (cwd: string, sinceDay: string | null) => GitStats;
  cwd: string;
  now?: Date;
}

/** True when the event's working dir is inside the given repo path. */
function inRepo(event: { cwd: string | null }, repo: string): boolean {
  return event.cwd != null && (event.cwd === repo || event.cwd.startsWith(repo + '/'));
}

/**
 * Orchestrates the local pipeline: collect raw usage from every source, resolve
 * cost per event, window it, optionally scope to the current project, aggregate,
 * then estimate efficiency against local git activity. Pure given its deps.
 *
 * Scoping matters: git commits/lines are always for the current repo, so to make
 * "cost per commit" meaningful the usage must be scoped to the same repo (by the
 * event's cwd). Pass allProjects to opt out and see global spend instead.
 */
export class CollectUsageUseCase {
  constructor(private deps: CollectDeps) {}

  execute(input: { days: number | null; allProjects?: boolean }): Report {
    const { days } = input;
    const now = this.deps.now ?? new Date();
    const sinceDay = days === null ? null : daysAgo(days, now);

    const git = this.deps.gitStats(this.deps.cwd, sinceDay);
    const claude = this.deps.collectClaudeCode();
    const codex = this.deps.collectCodex();
    const copilot = this.deps.collectCopilot();
    let costed = filterSince([...claude, ...codex, ...copilot].map(costEvent), sinceDay);

    const scopeToProject = !input.allProjects && git.repo != null;
    if (scopeToProject) {
      const repo = git.repo as string;
      costed = costed.filter((e) => inRepo(e, repo));
    }

    const aggregate = buildAggregate(costed);
    const efficiency = computeEfficiency(aggregate, git);

    return {
      aggregate,
      efficiency,
      git,
      days,
      scope: scopeToProject ? 'project' : 'all',
      sources: {
        claudeCode: costed.filter((e) => e.source === 'claude-code').length,
        codex: costed.filter((e) => e.source === 'codex').length,
        copilot: costed.filter((e) => e.source === 'copilot').length,
      },
    };
  }
}
