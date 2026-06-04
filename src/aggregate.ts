import type { Aggregate, CostedEvent, ModelRollup, ToolSource } from './types.js';

/** YYYY-MM-DD from an ISO timestamp (UTC). */
export function isoDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Keep only events on/after `sinceDay` (YYYY-MM-DD). Empty cutoff = keep all. */
export function filterSince(events: CostedEvent[], sinceDay: string | null): CostedEvent[] {
  if (!sinceDay) return events;
  return events.filter((e) => isoDay(e.timestamp) >= sinceDay);
}

/** Day string N days before today (UTC). */
export function daysAgo(n: number, now = new Date()): string {
  const d = new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Build the upload-safe aggregate from costed events. */
export function buildAggregate(events: CostedEvent[]): Aggregate {
  const byModelMap = new Map<string, ModelRollup>();
  const bySource: Partial<Record<ToolSource, number>> = {};
  const byDay: Record<string, number> = {};

  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let from: string | null = null;
  let to: string | null = null;

  for (const e of events) {
    totalCost += e.cost;
    inputTokens += e.inputTokens;
    outputTokens += e.outputTokens;
    cacheCreationTokens += e.cacheCreationTokens;
    cacheReadTokens += e.cacheReadTokens;

    const day = isoDay(e.timestamp);
    byDay[day] = (byDay[day] ?? 0) + e.cost;
    if (from === null || day < from) from = day;
    if (to === null || day > to) to = day;

    bySource[e.source] = (bySource[e.source] ?? 0) + e.cost;

    const key = `${e.source}:${e.model}`;
    const roll =
      byModelMap.get(key) ??
      {
        model: e.model,
        source: e.source,
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
      };
    roll.events += 1;
    roll.inputTokens += e.inputTokens;
    roll.outputTokens += e.outputTokens;
    roll.cacheCreationTokens += e.cacheCreationTokens;
    roll.cacheReadTokens += e.cacheReadTokens;
    roll.cost += e.cost;
    byModelMap.set(key, roll);
  }

  const cacheDenom = cacheReadTokens + cacheCreationTokens + inputTokens;
  const cacheHitRate = cacheDenom > 0 ? cacheReadTokens / cacheDenom : 0;

  return {
    from,
    to,
    events: events.length,
    totalCost,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cacheHitRate,
    byModel: [...byModelMap.values()].sort((a, b) => b.cost - a.cost),
    bySource,
    byDay,
  };
}
