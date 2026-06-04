import type { UsageEvent, CostedEvent } from './types.js';

/**
 * Per-million-token prices in USD. A small bundled snapshot — the hosted API
 * pushes fresh prices so this stays current. Prices are deliberately
 * conservative public list prices; cache-read/creation tracked separately
 * because they dominate cost in long agent sessions.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PER_MILLION = 1_000_000;

/**
 * Matchers are checked in order; first substring hit wins. Keep specific
 * names before generic family names.
 */
const PRICE_TABLE: Array<{ match: string; price: ModelPrice }> = [
  // ── Anthropic (Claude Code) ──────────────────────────────────────────────
  { match: 'opus', price: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 } },
  { match: 'sonnet', price: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { match: 'haiku', price: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 } },
  // ── OpenAI (Codex) ───────────────────────────────────────────────────────
  { match: 'gpt-5-mini', price: { input: 0.25, output: 2, cacheWrite: 0.25, cacheRead: 0.025 } },
  { match: 'gpt-5', price: { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 } },
  { match: 'o3', price: { input: 2, output: 8, cacheWrite: 2, cacheRead: 0.5 } },
  { match: 'gpt-4o', price: { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 } },
  { match: 'gpt-4.1', price: { input: 2, output: 8, cacheWrite: 2, cacheRead: 0.5 } },
];

/** Fallback when a model id matches nothing — mid-tier estimate, flagged by caller via costFrom. */
const FALLBACK_PRICE: ModelPrice = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

/** Look up the price for a model id by case-insensitive substring match. */
export function priceFor(model: string): ModelPrice {
  const m = model.toLowerCase();
  for (const entry of PRICE_TABLE) {
    if (m.includes(entry.match)) return entry.price;
  }
  return FALLBACK_PRICE;
}

/** Compute the USD cost of a single usage event from token counts. */
export function computeCostFromTokens(event: UsageEvent): number {
  const p = priceFor(event.model);
  return (
    (event.inputTokens * p.input +
      event.outputTokens * p.output +
      event.cacheCreationTokens * p.cacheWrite +
      event.cacheReadTokens * p.cacheRead) /
    PER_MILLION
  );
}

/**
 * Resolve the cost of an event: prefer the tool-reported costUSD when present
 * and finite, otherwise compute from the pricing table (the common case —
 * Claude Code leaves costUSD null).
 */
export function costEvent(event: UsageEvent): CostedEvent {
  if (event.costUSD !== null && Number.isFinite(event.costUSD) && event.costUSD >= 0) {
    return { ...event, cost: event.costUSD, costFrom: 'reported' };
  }
  return { ...event, cost: computeCostFromTokens(event), costFrom: 'computed' };
}
