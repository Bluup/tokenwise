import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Credentials {
  access_token: string;
  refresh_token: string;
  login: string;
}

function credsDir(): string {
  return join(homedir(), '.tokenwise');
}
function credsPath(): string {
  return join(credsDir(), 'credentials.json');
}

export function loadCredentials(): Credentials | null {
  try {
    const c = JSON.parse(readFileSync(credsPath(), 'utf8')) as Partial<Credentials>;
    if (c.access_token && c.refresh_token && c.login) {
      return { access_token: c.access_token, refresh_token: c.refresh_token, login: c.login };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCredentials(c: Credentials): void {
  mkdirSync(credsDir(), { recursive: true });
  writeFileSync(credsPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
}

export function clearCredentials(): void {
  try {
    unlinkSync(credsPath());
  } catch {
    /* already gone */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  );
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* user can open the printed URL manually */
  }
}

/** Decode a JWT's `exp` claim (seconds since epoch), or null. */
function jwtExp(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Return a valid access token, refreshing via the Supabase token endpoint when
 * the current one is expired/near-expiry. Returns null if refresh fails (caller
 * falls back to anonymous submit).
 */
export async function getValidAccessToken(
  creds: Credentials,
  opts: { refreshUrl: string; anonKey: string; now?: number },
): Promise<string | null> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const exp = jwtExp(creds.access_token);
  if (exp && exp - now > 60) return creds.access_token;

  try {
    const res = await fetch(opts.refreshUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: opts.anonKey,
        authorization: `Bearer ${opts.anonKey}`,
      },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!data.access_token || !data.refresh_token) return null;
    saveCredentials({ ...creds, access_token: data.access_token, refresh_token: data.refresh_token });
    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Browser-based GitHub login. Spins a one-shot localhost server, opens the
 * /cli-auth bridge on the site (which runs Supabase GitHub OAuth), and captures
 * the session tokens it redirects back. Stores them in ~/.tokenwise.
 */
export function login(siteUrl: string): Promise<{ login: string }> {
  const state = randomUUID();
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback') {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ok =
        u.searchParams.get('state') === state &&
        u.searchParams.get('access_token') &&
        u.searchParams.get('refresh_token') &&
        u.searchParams.get('login');
      if (!ok) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end('<p>Invalid login response. Close this tab and try again.</p>');
        return;
      }
      const gh = (u.searchParams.get('login') ?? '').toLowerCase();
      saveCredentials({
        access_token: u.searchParams.get('access_token') as string,
        refresh_token: u.searchParams.get('refresh_token') as string,
        login: gh,
      });
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        `<html><body style="font-family:system-ui,sans-serif;background:#09090b;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="color:#10b981;font-size:40px">&#10003;</div><h2>Verified as @${escapeHtml(gh)}</h2><p style="color:#a1a1aa">You can close this tab and return to your terminal.</p></div></body></html>`,
      );
      server.close();
      resolve({ login: gh });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const authUrl = `${siteUrl}/cli-auth?port=${port}&state=${state}`;
      process.stdout.write(
        `\n  Opening your browser to sign in with GitHub…\n  If it doesn't open, visit:\n  ${authUrl}\n\n`,
      );
      openBrowser(authUrl);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('login timed out — try again'));
    }, 180_000);
  });
}
