import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageEvent } from '../types.js';

/**
 * GitHub Copilot CLI usage. EXPERIMENTAL: Copilot's local format is less
 * documented than Claude Code / Codex and varies by version. We scan its data
 * dir for JSON/JSONL records and pull token usage from the shapes we know
 * (Anthropic-style `message.usage`, OTEL `gen_ai.usage.*`, or flat
 * `input_tokens`/`output_tokens`). Anything unrecognized is skipped — this
 * source never throws and returns [] when nothing matches.
 */
export function defaultCopilotDir(): string {
  const override = process.env.COPILOT_HOME;
  return override && override.trim() ? override : join(homedir(), '.copilot');
}

function walk(dir: string): string[] {
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
    if (s.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.jsonl') || name.endsWith('.json') || name.endsWith('.log')) {
      out.push(full);
    }
  }
  return out;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

interface Extracted {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** Pull a token-usage reading from one record, or null if it has none. */
function extractUsage(obj: Record<string, unknown>): Extracted | null {
  // 1) Anthropic-style: message.usage
  const message = obj['message'] as Record<string, unknown> | undefined;
  const mUsage = message?.['usage'] as Record<string, unknown> | undefined;
  if (mUsage && (mUsage['input_tokens'] != null || mUsage['output_tokens'] != null)) {
    return {
      model: typeof message?.['model'] === 'string' ? (message['model'] as string) : modelOf(obj),
      input: num(mUsage['input_tokens']),
      output: num(mUsage['output_tokens']),
      cacheRead: num(mUsage['cache_read_input_tokens']),
      cacheCreation: num(mUsage['cache_creation_input_tokens']),
    };
  }

  // 2) OTEL gen_ai semantic conventions (flat attribute keys)
  const attrs = (obj['attributes'] as Record<string, unknown> | undefined) ?? obj;
  const otelIn = attrs['gen_ai.usage.input_tokens'] ?? attrs['gen_ai.usage.prompt_tokens'];
  const otelOut = attrs['gen_ai.usage.output_tokens'] ?? attrs['gen_ai.usage.completion_tokens'];
  if (otelIn != null || otelOut != null) {
    return {
      model: typeof attrs['gen_ai.request.model'] === 'string' ? (attrs['gen_ai.request.model'] as string) : modelOf(obj),
      input: num(otelIn),
      output: num(otelOut),
      cacheRead: 0,
      cacheCreation: 0,
    };
  }

  // 3) Flat input_tokens/output_tokens (incl. OpenAI prompt/completion)
  const flatIn = obj['input_tokens'] ?? obj['prompt_tokens'];
  const flatOut = obj['output_tokens'] ?? obj['completion_tokens'];
  if (flatIn != null || flatOut != null) {
    return {
      model: modelOf(obj),
      input: num(flatIn),
      output: num(flatOut),
      cacheRead: num(obj['cached_input_tokens'] ?? obj['cache_read_input_tokens']),
      cacheCreation: 0,
    };
  }

  return null;
}

function modelOf(obj: Record<string, unknown>): string {
  for (const k of ['model', 'gen_ai.request.model', 'request_model']) {
    if (typeof obj[k] === 'string' && obj[k]) return obj[k] as string;
  }
  return 'gpt-4o';
}

function timestampOf(obj: Record<string, unknown>): string {
  const t = obj['timestamp'] ?? obj['time'] ?? obj['created_at'] ?? obj['createdAt'];
  if (typeof t === 'string' && t) return t;
  if (typeof t === 'number' && Number.isFinite(t)) {
    // seconds vs ms heuristic
    return new Date(t < 1e12 ? t * 1000 : t).toISOString();
  }
  return '';
}

/** Collect Copilot usage events (best-effort). */
export function collectCopilot(baseDir = defaultCopilotDir()): UsageEvent[] {
  if (!existsSync(baseDir)) return [];
  const events: UsageEvent[] = [];
  for (const file of walk(baseDir)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || (t[0] !== '{' && t[0] !== '[')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(t);
      } catch {
        continue;
      }
      const records = Array.isArray(parsed) ? parsed : [parsed];
      for (const rec of records) {
        if (!rec || typeof rec !== 'object') continue;
        const obj = rec as Record<string, unknown>;
        const u = extractUsage(obj);
        if (!u || (u.input === 0 && u.output === 0)) continue;
        const ts = timestampOf(obj);
        if (!ts) continue;
        events.push({
          source: 'copilot',
          model: u.model,
          timestamp: ts,
          inputTokens: u.input,
          outputTokens: u.output,
          cacheCreationTokens: u.cacheCreation,
          cacheReadTokens: u.cacheRead,
          costUSD: null,
          cwd: null,
        });
      }
    }
  }
  return events;
}
