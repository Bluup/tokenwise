#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectClaudeCode } from './sources/claude-code.js';
import { collectCodex } from './sources/codex.js';
import { gitStats } from './git.js';
import { CollectUsageUseCase } from './usecases/CollectUsageUseCase.js';
import { buildPayload } from './privacy.js';
import { renderReport, renderCardSVG, c } from './render.js';
import { SUBMISSIONS_URL, LEADERBOARD_URL, SUPABASE_ANON_KEY } from './config.js';

const VERSION = '0.1.2';

interface Flags {
  cmd: string;
  days: number | null;
  handle: string;
  json: boolean;
  dryRun: boolean;
  allProjects: boolean;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    cmd: 'report',
    days: 30,
    handle: '@you',
    json: false,
    dryRun: false,
    allProjects: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') flags.days = null;
    else if (arg === '--all-projects') flags.allProjects = true;
    else if (arg === '--days') flags.days = Number.parseInt(argv[++i] ?? '30', 10) || 30;
    else if (arg === '--handle') flags.handle = argv[++i] ?? flags.handle;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--version' || arg === '-v') flags.cmd = 'version';
    else if (arg === '--help' || arg === '-h') flags.cmd = 'help';
    else if (arg && !arg.startsWith('-')) rest.push(arg);
  }
  if (rest[0]) flags.cmd = rest[0];
  return flags;
}

const HELP = `
  ${c.wise(c.bold('tokenwise'))} — the efficiency layer for AI coding spend

  ${c.dim('Usage')}
    npx tokenwise-cli [command] [options]

  ${c.dim('Commands')}
    report            Show your spend + efficiency score (default)
    score             Print just your efficiency score
    share             Write a shareable card to ./tokenwise-card.svg
    submit            Preview the anonymized aggregate, then upload (opt-in)

  ${c.dim('Options')}
    --days <n>        Window in days (default: 30)
    --all             All-time, no window
    --all-projects    Score across every project (default: just this repo)
    --handle <@x>     Handle for your shareable card
    --json            Output raw JSON
    --dry-run         Preview the aggregate without uploading
    -v, --version     Print version
    -h, --help        Show this help

  ${c.dim('Privacy: only anonymized aggregates ever leave your machine —')}
  ${c.dim('never prompts, code, file paths or branch names. Run `submit` to see exactly what.')}
`;

function buildReport(flags: Flags) {
  const useCase = new CollectUsageUseCase({
    collectClaudeCode,
    collectCodex,
    gitStats,
    cwd: process.cwd(),
  });
  return useCase.execute({ days: flags.days, allProjects: flags.allProjects });
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.cmd === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flags.cmd === 'help') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  if (flags.cmd === 'report') {
    const report = buildReport(flags);
    if (flags.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else process.stdout.write(renderReport(report));
    return 0;
  }

  if (flags.cmd === 'score') {
    const report = buildReport(flags);
    process.stdout.write(
      flags.json
        ? JSON.stringify(report.efficiency, null, 2) + '\n'
        : `${report.efficiency.score}\n`,
    );
    return 0;
  }

  if (flags.cmd === 'share') {
    const report = buildReport(flags);
    if (report.aggregate.events === 0) {
      process.stdout.write(renderReport(report));
      return 0;
    }
    const svg = renderCardSVG(report, flags.handle);
    const out = resolve(process.cwd(), 'tokenwise-card.svg');
    writeFileSync(out, svg, 'utf8');
    process.stdout.write(
      `\n  ${c.wise('✓')} Card written to ${c.bold('tokenwise-card.svg')}\n` +
        `  ${c.dim('Score')} ${c.bold(String(report.efficiency.score))}${c.dim('/100')} · ${c.dim('share it and tag @Bluup')}\n\n`,
    );
    return 0;
  }

  if (flags.cmd === 'submit') {
    const report = buildReport(flags);
    if (report.aggregate.events === 0) {
      process.stdout.write(renderReport(report));
      return 0;
    }
    const payload = buildPayload(report.aggregate, report.efficiency, report.git, {
      clientVersion: VERSION,
      days: flags.days,
      handle: flags.handle,
    });

    // Always show exactly what would be uploaded — trust is the product.
    process.stdout.write(`\n  ${c.dim('This is the ONLY data that leaves your machine:')}\n\n`);
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n\n');

    if (flags.dryRun) {
      process.stdout.write(`  ${c.dim('Dry run — nothing uploaded. Drop --dry-run to submit.')}\n\n`);
      return 0;
    }
    if (flags.handle === '@you') {
      process.stdout.write(
        `  ${c.dim('Pass')} ${c.bold('--handle @yourname')} ${c.dim('to claim your spot on the leaderboard.')}\n\n`,
      );
      return 0;
    }

    // Insert raw aggregates; the DB trigger computes the official score.
    const headers = {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'return=minimal',
    };
    const row = {
      handle: payload.handle,
      total_cost: payload.aggregate.totalCost,
      events: payload.aggregate.events,
      commits: payload.shipped.commits,
      lines_added: payload.shipped.linesAdded,
      cache_hit_rate: payload.aggregate.cacheHitRate,
      window_days: payload.window.days,
      project_id: payload.projectId,
      client: payload.client,
    };

    try {
      const res = await fetch(SUBMISSIONS_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let msg = body;
        try {
          msg = (JSON.parse(body) as { message?: string }).message ?? body;
        } catch {
          /* not JSON */
        }
        if (/rate_limited/.test(msg)) {
          process.stdout.write(`  ${c.dim('⏳ ' + msg.replace('rate_limited: ', ''))}\n\n`);
          return 0;
        }
        process.stdout.write(`  ${c.red('✗')} Submit failed: ${res.status} ${c.dim(msg)}\n\n`);
        return 1;
      }

      // Fetch the official (DB-computed) score + rank for this handle.
      let line = `  ${c.wise('✓')} Submitted. You're on the efficiency leaderboard.`;
      try {
        const q = `${LEADERBOARD_URL}?handle=eq.${encodeURIComponent(payload.handle)}&select=rank,score&limit=1`;
        const lb = await fetch(q, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
        if (lb.ok) {
          const rows = (await lb.json()) as Array<{ rank: number; score: number }>;
          const me = rows[0];
          if (me) line = `  ${c.wise('✓')} Official score ${c.bold(String(me.score))}${c.dim('/100')} · rank ${c.bold('#' + me.rank)} on the efficiency leaderboard.`;
        }
      } catch {
        /* rank lookup is best-effort */
      }
      process.stdout.write(`${line}\n  ${c.dim('See it at')} ${c.wise('https://tokenwise.dev/#leaderboard')}\n\n`);
      return 0;
    } catch (err) {
      process.stdout.write(`  ${c.red('✗')} Submit error: ${(err as Error).message}\n\n`);
      return 1;
    }
  }

  process.stdout.write(`  ${c.red('Unknown command:')} ${flags.cmd}\n${HELP}\n`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`tokenwise: ${(err as Error).message}\n`);
    process.exit(1);
  });
