import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageEvent } from '../types.js';

/** Default location of Claude Code session logs. */
export function defaultClaudeDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  const base = override && override.trim() ? override : join(homedir(), '.claude');
  return join(base, 'projects');
}

/** Recursively list every .jsonl file under a directory. */
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
    if (s.isDirectory()) {
      out.push(...walkJsonl(full));
    } else if (name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Parse one JSONL line into a UsageEvent, or null if it isn't a costed assistant turn. */
export function parseClaudeLine(line: string): UsageEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null; // defensive: skip malformed lines, never crash the run
  }

  const message = obj['message'] as Record<string, unknown> | undefined;
  if (!message || typeof message !== 'object') return null;
  if (message['role'] !== 'assistant') return null;

  const usage = message['usage'] as RawUsage | undefined;
  if (!usage || typeof usage !== 'object') return null;

  const model = typeof message['model'] === 'string' ? (message['model'] as string) : '';
  if (!model || model === '<synthetic>') return null;

  const timestamp =
    typeof obj['timestamp'] === 'string' ? (obj['timestamp'] as string) : '';
  if (!timestamp) return null;

  const costUSD =
    typeof obj['costUSD'] === 'number' && Number.isFinite(obj['costUSD'])
      ? (obj['costUSD'] as number)
      : null;

  return {
    source: 'claude-code',
    model,
    timestamp,
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheCreationTokens: num(usage.cache_creation_input_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    costUSD,
    cwd: typeof obj['cwd'] === 'string' ? (obj['cwd'] as string) : null,
  };
}

/** Collect all Claude Code usage events from disk. */
export function collectClaudeCode(baseDir = defaultClaudeDir()): UsageEvent[] {
  if (!existsSync(baseDir)) return [];
  const events: UsageEvent[] = [];
  for (const file of walkJsonl(baseDir)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const ev = parseClaudeLine(line);
      if (ev) events.push(ev);
    }
  }
  return events;
}
