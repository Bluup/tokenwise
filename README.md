# tokenwise

**The efficiency layer for AI coding spend.** Stop flexing how much you burned — flex how much you shipped per dollar.

Every AI-coding tracker ranks you by tokens torched, so the "winner" is whoever wasted the most. Tokenwise flips it: one honest score for **value shipped per dollar**, across Claude Code and Codex.

```bash
npx tokenwise-cli
```

> Published as **`tokenwise-cli`** on npm; the installed binary is `tokenwise` (`npm i -g tokenwise-cli`, then `tokenwise`).

```
  tokenwise · efficiency, not waste

  EFFICIENCY SCORE  (local estimate · last 30 days)
  92/100  ████████████████████████

  Cost / commit    $0.41
  Cache hit rate   73%
  Spent            $128.40  (1,204 turns)
  Shipped          312 commits  +18420/-6310 lines
```

## Commands

| Command | What it does |
|---|---|
| `npx tokenwise-cli` | Show your spend + efficiency score (default `report`) |
| `tokenwise score` | Print just your efficiency score |
| `tokenwise share` | Write a shareable card to `./tokenwise-card.svg` |
| `tokenwise submit --handle @you` | Preview the exact anonymized aggregate, then post it to the leaderboard |

Options: `--days <n>` (default 30), `--all`, `--all-projects`, `--handle <@you>`, `--json`, `--dry-run`.

**Scope:** by default the score is for the **current repo** — usage is scoped (by each
session's working directory) to the repo you run it in, so "cost per commit" lines up
with that repo's commits. Add `--all-projects` for your global spend across everything.

`submit` posts your anonymized aggregate straight to the leaderboard (Supabase
PostgREST, anon key bundled). The official score is computed in the database, so
nobody can fake it. Use `--dry-run` to preview without uploading. Self-host by
overriding `TOKENWISE_SUPABASE_URL` / `TOKENWISE_SUPABASE_ANON_KEY`.

## Privacy — this is the whole point

This CLI is **open source (MIT)** precisely because it touches your most sensitive data: prompts, code, file paths. So you can read it and verify the promise:

> **Only anonymized numeric aggregates ever leave your machine.** Never prompts, never code, never file paths or branch names.

Run `tokenwise submit` to print the **exact** JSON that would be uploaded before anything is sent. Project paths appear only as a one-way SHA-256 hash. Cost is computed locally. The leaderboard and card are **opt-in**.

## How it works

1. Reads local logs from **Claude Code** (`~/.claude/projects/**/*.jsonl`), **Codex** (`~/.codex/sessions/**/*.jsonl`) and **Copilot CLI** (`~/.copilot/`, experimental).
2. Computes real cost from a bundled pricing table (Claude Code leaves cost out, so we calculate it — including cache-read/creation rates).
3. Pairs spend with your local **git** activity (commits, lines kept) to estimate efficiency: cost per merged PR, per kept line, cache reuse.
4. The **official ranked score** on the leaderboard is computed server-side from these aggregates (anti-gaming) — the CLI shows a local estimate.

## Sources

| Tool | Support | Notes |
|---|---|---|
| **Claude Code** | ✅ full | the anchor — local JSONL with token usage |
| **Codex CLI** | ✅ experimental | token tracking only in recent builds |
| **Copilot CLI** | ⚠️ experimental | best-effort local-log parsing; format varies |
| **Cursor** | ❌ not supported | billing is server-side; local data has no token/cost. (Teams: a Cursor Admin-API path is on the roadmap.) |

Copilot/Codex sessions don't record a working directory, so they only count under `--all-projects` (the per-repo score needs a cwd).

MIT © Bluu — part of [tokenwise.dev](https://tokenwise.dev)
