import { execFileSync } from 'node:child_process';
import type { GitStats } from './types.js';

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Read git activity in `cwd` since `sinceDay` (YYYY-MM-DD). This is the "value
 * shipped" signal for the local efficiency estimate. Returns available:false
 * when not a git repo or git is missing — efficiency degrades gracefully.
 */
export function gitStats(cwd: string, sinceDay: string | null): GitStats {
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  if (!top) return { available: false, repo: null, commits: 0, linesAdded: 0, linesDeleted: 0 };

  const sinceArgs = sinceDay ? ['--since', `${sinceDay}T00:00:00`] : [];

  const countOut = git(['rev-list', '--count', 'HEAD', ...sinceArgs], top);
  const commits = countOut ? Number.parseInt(countOut, 10) || 0 : 0;

  // Sum added/deleted lines across commits in the window.
  const numstat = git(
    ['log', '--numstat', '--pretty=tformat:', ...sinceArgs, 'HEAD'],
    top,
  );
  let linesAdded = 0;
  let linesDeleted = 0;
  if (numstat) {
    for (const line of numstat.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const a = Number.parseInt(parts[0] ?? '', 10);
      const d = Number.parseInt(parts[1] ?? '', 10);
      if (Number.isFinite(a)) linesAdded += a; // "-" (binary) parses to NaN → skipped
      if (Number.isFinite(d)) linesDeleted += d;
    }
  }

  return { available: true, repo: top, commits, linesAdded, linesDeleted };
}
