import type { Report } from './usecases/CollectUsageUseCase.js';

// ── ANSI helpers (zero-dep) ──────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `[${code}m${s}[0m` : s);
export const c = {
  wise: wrap('38;2;16;185;129'), // emerald #10B981
  bold: wrap('1'),
  dim: wrap('2'),
  white: wrap('97'),
  red: wrap('31'),
};

export function usd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function bar(score: number, width = 24): string {
  const filled = Math.round((score / 100) * width);
  return c.wise('█'.repeat(filled)) + c.dim('░'.repeat(Math.max(0, width - filled)));
}

/** Human-readable terminal report. */
export function renderReport(r: Report): string {
  const a = r.aggregate;
  const e = r.efficiency;
  const window = r.days === null ? 'all time' : `last ${r.days} days`;
  const scope =
    r.scope === 'project'
      ? `this project${r.git.repo ? ' · ' + r.git.repo.split('/').pop() : ''}`
      : 'all projects';
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${c.wise(c.bold('tokenwise'))} ${c.dim('· efficiency, not waste')}`);
  lines.push('');

  if (a.events === 0) {
    lines.push(`  ${c.dim(`No AI coding usage found for ${scope} (${window}).`)}`);
    lines.push(
      r.scope === 'project'
        ? `  ${c.dim('Run inside a repo where you use AI, or add')} ${c.bold('--all-projects')}${c.dim('.')}`
        : `  ${c.dim('Use Claude Code or Codex, then run this again.')}`,
    );
    lines.push('');
    return lines.join('\n');
  }

  // Efficiency score headline
  lines.push(`  ${c.dim('EFFICIENCY SCORE')}  ${c.dim(`(local estimate · ${scope} · ${window})`)}`);
  lines.push(`  ${c.bold(c.white(String(e.score)))}${c.dim('/100')}  ${bar(e.score)}`);
  lines.push('');

  // Key metrics
  const cpc = e.costPerCommit === null ? c.dim('— (no git commits)') : c.white(usd(e.costPerCommit));
  lines.push(`  ${c.dim('Cost / commit')}    ${cpc}`);
  lines.push(`  ${c.dim('Cache hit rate')}   ${c.white(pct(e.cacheHitRate))}`);
  lines.push(`  ${c.dim('Spent')}            ${c.white(usd(a.totalCost))}  ${c.dim(`(${a.events} turns)`)}`);
  if (r.git.available) {
    lines.push(`  ${c.dim('Shipped')}          ${c.white(`${r.git.commits} commits`)}  ${c.dim(`+${r.git.linesAdded}/-${r.git.linesDeleted} lines`)}`);
  }
  lines.push('');

  // By model
  lines.push(`  ${c.dim('BY MODEL')}`);
  for (const m of a.byModel.slice(0, 5)) {
    const share = a.totalCost > 0 ? m.cost / a.totalCost : 0;
    lines.push(
      `  ${c.white(m.model.padEnd(22))} ${usd(m.cost).padStart(8)} ${c.dim(pct(share).padStart(5))}`,
    );
  }
  lines.push('');

  // Sources
  const srcs: string[] = [];
  if (r.sources.claudeCode) srcs.push(`Claude Code (${r.sources.claudeCode})`);
  if (r.sources.codex) srcs.push(`Codex (${r.sources.codex})`);
  lines.push(`  ${c.dim('Sources: ' + (srcs.join(', ') || 'none'))}`);
  lines.push(`  ${c.dim('Share your card:')} ${c.wise('npx tokenwise-cli share')}`);
  lines.push('');

  return lines.join('\n');
}

/** A shareable SVG card matching the Tokenwise brand (dark, emerald). */
export function renderCardSVG(r: Report, handle: string): string {
  const e = r.efficiency;
  const a = r.aggregate;
  const cpc = e.costPerCommit === null ? '—' : usd(e.costPerCommit);
  const barW = Math.round((e.score / 100) * 468);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeHandle = esc(handle).slice(0, 24);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="280" viewBox="0 0 500 280" font-family="Geist, Inter, system-ui, sans-serif">
  <rect width="500" height="280" rx="16" fill="#09090B"/>
  <rect x="0.5" y="0.5" width="499" height="279" rx="16" fill="none" stroke="#10B981" stroke-opacity="0.25"/>
  <rect x="16" y="16" width="468" height="2" rx="1" fill="#10B981" fill-opacity="0.5"/>
  <g transform="translate(32,40)">
    <rect width="22" height="22" rx="5" fill="#10B981"/>
    <text x="11" y="16" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">t</text>
    <text x="32" y="16" font-size="13" fill="#A1A1AA" font-family="Geist Mono, monospace">tokenwise.dev</text>
    <text x="436" y="16" text-anchor="end" font-size="12" fill="#10B981" font-family="Geist Mono, monospace">EFFICIENCY</text>
  </g>
  <g transform="translate(32,90)">
    <text font-size="12" fill="#71717A" font-family="Geist Mono, monospace" letter-spacing="1">EFFICIENCY SCORE</text>
    <text y="62" font-size="72" font-weight="600" fill="#fff" font-family="Geist Mono, monospace">${e.score}<tspan font-size="28" fill="#3F3F46">/100</tspan></text>
    <text x="436" y="50" text-anchor="end" font-size="15" fill="#A1A1AA" font-family="Geist Mono, monospace">${safeHandle}</text>
  </g>
  <g transform="translate(32,178)">
    <rect width="436" height="6" rx="3" fill="#27272A"/>
    <rect width="${barW}" height="6" rx="3" fill="#10B981"/>
  </g>
  <g transform="translate(32,212)" font-family="Geist Mono, monospace">
    <text font-size="10" fill="#52525B" letter-spacing="1">COST / COMMIT</text>
    <text y="22" font-size="18" font-weight="600" fill="#fff">${cpc}</text>
    <text x="160" font-size="10" fill="#52525B" letter-spacing="1">CACHE HITS</text>
    <text x="160" y="22" font-size="18" font-weight="600" fill="#fff">${Math.round(e.cacheHitRate * 100)}%</text>
    <text x="300" font-size="10" fill="#52525B" letter-spacing="1">SPENT</text>
    <text x="300" y="22" font-size="18" font-weight="600" fill="#fff">${usd(a.totalCost)}</text>
  </g>
</svg>`;
}
