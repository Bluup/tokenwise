import type { Aggregate, Efficiency, GitStats } from './types.js';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Map a value where `low` scores best (1) and `high` scores worst (0). */
function inverseBand(value: number, low: number, high: number): number {
  return clamp01((high - value) / (high - low));
}

/**
 * Local efficiency estimate (0..100). This is a transparent heuristic for the
 * CLI preview — the hosted leaderboard computes the official, anti-gaming
 * ranked score server-side from the same aggregates.
 *
 * Signals:
 *  - cost per commit  (value shipped per dollar — the headline)
 *  - cost per 1k lines kept
 *  - cache hit rate   (good context reuse = skill, cheap signal)
 */
export function computeEfficiency(agg: Aggregate, git: GitStats): Efficiency {
  const cacheHitRate = agg.cacheHitRate;

  const costPerCommit =
    git.available && git.commits > 0 ? agg.totalCost / git.commits : null;
  const costPerKLoc =
    git.available && git.linesAdded > 0 ? agg.totalCost / (git.linesAdded / 1000) : null;

  let score: number;
  if (costPerCommit !== null) {
    const commitScore = inverseBand(costPerCommit, 0.25, 5); // $0.25/commit → great, $5 → poor
    const locScore =
      costPerKLoc !== null ? inverseBand(costPerKLoc, 0.5, 20) : commitScore;
    score = 100 * (0.5 * commitScore + 0.2 * locScore + 0.3 * cacheHitRate);
  } else {
    // No ship signal (not a git repo / no commits in window): fall back to a
    // cache-weighted neutral baseline so the number isn't misleading.
    score = 100 * (0.5 * cacheHitRate + 0.25);
  }

  return {
    score: Math.round(Math.max(1, Math.min(100, score))),
    costPerCommit,
    costPerKLoc,
    cacheHitRate,
  };
}
