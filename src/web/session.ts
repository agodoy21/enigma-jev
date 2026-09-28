/**
 * The page's access key: a TypeSafe key entered in the browser, verified with
 * one Jev call, then sealed into an HttpOnly session cookie.
 *
 * The cookie holds the key encrypted with AES-256-GCM under SESSION_SECRET, so
 * the session survives on any server instance (a Vercel deployment runs many)
 * while the page's scripts can never read it and nobody without the secret can
 * open it. The key is never written to disk and never logged: the verification
 * call skips the audit log, and later calls log requests and answers only.
 *
 * Without SESSION_SECRET, a random secret is drawn at start-up: fine for one
 * local server, whose restart then forgets every session. A deployment must set
 * it (any long random string), or unlocking is refused.
 */
import { DEFAULT_JEV_MODEL, JevApiError, JevClient } from '../jev/client.js';

export interface Session {
  readonly client: JevClient;
  readonly model: string;
  /** The last four characters, for "key ••••wxyz" on the page. */
  readonly hint: string;
}

/** What the cookie carries, encrypted. */
interface Sealed {
  /** The key. */
  k: string;
  /** The model it was verified against. */
  m: string;
  /** Expiry, in ms since the epoch. */
  e: number;
}

const COOKIE = 'ej_session';
/** Sessions last 12 hours from unlocking. */
const TTL_MS = 12 * 3600 * 1000;
/** On Vercel the audit log would go to a read-only disk; skip it there. */
const LOG_PATH = process.env.VERCEL ? null : undefined;

/** A few attempts a minute are plenty for a person and useless for guessing (per server instance). */
const attempts: number[] = [];
const MAX_ATTEMPTS = 8;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

let secretKey: Promise<CryptoKey> | null = null;
function cipherKey(): Promise<CryptoKey> {
  secretKey ??= (async () => {
    const secret = process.env.SESSION_SECRET;
    const raw = secret
      ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
      : crypto.getRandomValues(new Uint8Array(32));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  })();
  return secretKey;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export async function seal(s: Sealed): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(s));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cipherKey(), data));
  return `${b64(iv)}.${b64(ct)}`;
}

/** The sealed contents, or null if the token was forged, altered, sealed under another secret, or expired. */
export async function open(token: string): Promise<Sealed | null> {
  const [iv, ct] = token.split('.');
  if (!iv || !ct) return null;
  try {
    const data = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(iv, 'base64url') },
      await cipherKey(),
      Buffer.from(ct, 'base64url'),
    );
    const s = JSON.parse(new TextDecoder().decode(data)) as Sealed;
    return typeof s.k === 'string' && s.e > Date.now() ? s : null;
  } catch {
    return null;
  }
}

function tokenOf(req: Request): string | null {
  const m = /(?:^|;\s*)ej_session=([A-Za-z0-9_.-]{20,2048})/.exec(req.headers.get('cookie') ?? '');
  return m ? m[1] : null;
}

/** HttpOnly always; Secure whenever the page itself arrived over HTTPS. */
function cookie(req: Request, value: string, maxAge: number): string {
  const https = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}

export async function sessionOf(req: Request): Promise<Session | null> {
  const t = tokenOf(req);
  const s = t ? await open(t) : null;
  if (!s) return null;
  return { client: new JevClient({ apiKey: s.k, model: s.m, logPath: LOG_PATH }), model: s.m, hint: s.k.slice(-4) };
}

export async function statusOf(req: Request) {
  const s = await sessionOf(req);
  return { unlocked: !!s, jev: !!s, model: s?.model ?? null, hint: s?.hint ?? null };
}

/** POST /api/unlock {key}: verify the key with one small Jev question, then seal it into the session cookie. */
export async function unlock(req: Request): Promise<Response> {
  const now = Date.now();
  while (attempts.length && now - attempts[0] > 60_000) attempts.shift();
  if (attempts.length >= MAX_ATTEMPTS)
    return json({ ok: false, reason: 'Too many attempts. Wait a minute and try again.' }, 429);
  attempts.push(now);

  if (process.env.VERCEL && !process.env.SESSION_SECRET)
    return json(
      { ok: false, reason: 'This deployment has no SESSION_SECRET set, so it cannot keep a session. Ask its owner.' },
      503,
    );

  let key = '';
  try {
    key = String((await req.json())?.key ?? '').trim();
  } catch {
    /* empty body */
  }
  if (!key) return json({ ok: false, reason: 'Enter your TypeSafe key.' }, 400);
  if (!/^[\x21-\x7e]{8,512}$/.test(key))
    return json({ ok: false, reason: 'That does not look like an API key: no spaces, 8 characters or more.' }, 400);

  const model = process.env.JEV_MODEL || DEFAULT_JEV_MODEL;
  const probe = new JevClient({ apiKey: key, model, maxRetries: 1, timeoutMs: 15000, logPath: null });
  try {
    // The same kind of judgement the page will ask for, on a text whose answer is obvious.
    const r = await probe.evaluate(
      'Codebreaker console self-test. A trial decryption reads: WETTERVORHERSAGEFUERMORGENXNEBELUEBERDEMFLUGPLATZ',
      {
        german: {
          type: 'noul',
          instructions:
            'Probability that this trial decryption is readable German plaintext (words run together, X for a full stop).',
        },
      },
    );
    const a = r.answers.answers.german;
    const german = a?.type === 'noul' ? a.noul : null;
    const token = await seal({ k: key, m: model, e: Date.now() + TTL_MS });
    return json({ ok: true, model, hint: key.slice(-4), latencyMs: Math.round(r.latencyMs), german }, 200, {
      'Set-Cookie': cookie(req, token, TTL_MS / 1000),
    });
  } catch (err) {
    if (err instanceof JevApiError && (err.status === 401 || err.status === 403))
      return json({ ok: false, reason: 'TypeSafe rejected this key.' }, 401);
    if (err instanceof JevApiError && err.status === 402)
      return json({ ok: false, reason: 'TypeSafe accepted the key, but the account has no credit.' }, 402);
    if (err instanceof JevApiError && err.status)
      return json({ ok: false, reason: `TypeSafe answered ${err.status}. Try again in a moment.` }, 502);
    return json({ ok: false, reason: 'Could not reach TypeSafe. Check the connection and try again.' }, 502);
  }
}

/** POST /api/lock: drop the session cookie from this browser. */
export function lock(req: Request): Response {
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(req, '', 0) });
}
