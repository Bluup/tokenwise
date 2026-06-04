import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageEvent } from '../types.js';

/** Default location of Codex CLI session logs. */
export function defaultCodexDir(): string {
  const override = process.env.CODEX_HOME;
  const base = override && override.trim() ? override : join(homedir(), '.codex');
  return join(base, 'sessions');
}

function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) out.push(...walkJsonl(full));
    else if (name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Recursively find the first object that looks like a token-usage record. */
function findTokenUsage(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if ('input_tokens' in obj || 'output_tokens' in obj) return obj;
  for (const key of ['total_token_usage', 'last_token_usage', 'info', 'usage', 'token_usage']) {
    const found = findTokenUsage(obj[key]);
    if (found) return found;
  }
  return null;
}

function findModel(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (typeof obj['model'] === 'string' && obj['model']) return obj['model'] as string;
  for (const v of Object.values(obj)) {
    const found = findModel(v);
    if (found) return found;
  }
  return null;
}

/**
 * Parse one Codex rollout file. token_count payloads are CUMULATIVE, so the
 * final snapshot is the session total — we emit a single event per session.
 * Experimental: Codex only began emitting token counts in late 2025.
 */
export function parseCodexFile(content: string): UsageEvent | null {
  let model: string | null = null;
  let lastUsage: Record<string, unknown> | null = null;
  let lastTimestamp = '';

  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!model) model = findModel(obj);
    const usage = findTokenUsage(obj);
    if (usage) {
      lastUsage = usage;
      if (typeof obj['timestamp'] === 'string') lastTimestamp = obj['timestamp'] as string;
    }
  }

  if (!lastUsage) return null;
  const input = num(lastUsage['input_tokens']);
  const output = num(lastUsage['output_tokens']);
  const cacheRead = num(lastUsage['cached_input_tokens'] ?? lastUsage['cache_read_input_tokens']);
  if (input === 0 && output === 0) return null;

  return {
    source: 'codex',
    model: model ?? 'gpt-5-codex',
    timestamp: lastTimestamp || new Date(0).toISOString(),
    // Codex reports cached tokens inside input_tokens; split them out so cost math matches Claude's shape.
    inputTokens: Math.max(0, input - cacheRead),
    outputTokens: output,
    cacheCreationTokens: 0,
    cacheReadTokens: cacheRead,
    costUSD: null,
    cwd: null,
  };
}

/** Collect Codex usage events (one per session file). */
export function collectCodex(baseDir = defaultCodexDir()): UsageEvent[] {
  if (!existsSync(baseDir)) return [];
  const events: UsageEvent[] = [];
  for (const file of walkJsonl(baseDir)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const ev = parseCodexFile(content);
    if (ev && ev.timestamp !== new Date(0).toISOString()) events.push(ev);
  }
  return events;
}
