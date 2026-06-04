/** Which AI coding tool a usage event came from. */
export type ToolSource = 'claude-code' | 'codex' | 'copilot';

/** A single normalized usage event (one assistant turn). */
export interface UsageEvent {
  source: ToolSource;
  /** Model id as reported by the tool, e.g. "claude-sonnet-4-6". */
  model: string;
  /** ISO timestamp of the turn. */
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Cost in USD if the tool precomputed it; null → we compute from pricing. */
  costUSD: number | null;
  /** Working directory of the session (used only locally, never uploaded raw). */
  cwd: string | null;
}

/** A usage event with its resolved cost in USD. */
export interface CostedEvent extends UsageEvent {
  cost: number;
  /** Whether `cost` came from the tool (costUSD) or our pricing table. */
  costFrom: 'reported' | 'computed';
}

/** Per-model rollup. */
export interface ModelRollup {
  model: string;
  source: ToolSource;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

/** The full aggregate over a time window — the only thing ever uploaded. */
export interface Aggregate {
  /** Inclusive ISO date bounds of the data (YYYY-MM-DD), or null if empty. */
  from: string | null;
  to: string | null;
  events: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Cache reuse ratio: cacheRead / (cacheRead + cacheCreation + input). 0..1 */
  cacheHitRate: number;
  byModel: ModelRollup[];
  bySource: Partial<Record<ToolSource, number>>;
  /** Per-day total cost, keyed by YYYY-MM-DD. */
  byDay: Record<string, number>;
}

/** Local git signal used to estimate efficiency (value shipped). */
export interface GitStats {
  available: boolean;
  repo: string | null;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
}

/** The local efficiency estimate (the server computes the official ranked score). */
export interface Efficiency {
  /** 0..100 local estimate. */
  score: number;
  costPerCommit: number | null;
  costPerKLoc: number | null;
  cacheHitRate: number;
}
