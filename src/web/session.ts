/**
 * The page's access key: a TypeSafe key entered in the browser, verified with
 * one Jev call, then held here in memory against an HttpOnly session cookie.
 *
 * The key crosses the wire once (to this server) and is never sent back, never
 * written to disk and never logged: the verification call skips the audit log,
 * and later calls log requests and answers only, as JevClient always has.
 * A server restart forgets every session; the page then asks again.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_JEV_MODEL, JevApiError, JevClient } from '../jev/client.js';

export interface Session {
  readonly client: JevClient;
  readonly model: string;
  /** The last four characters, for "key ••••wxyz" on the page. */
  readonly hint: string;
  readonly verifiedMs: number;
  last: number;
}

const COOKIE = 'ej_session';
/** Idle sessions expire after 12 hours. */
const IDLE_MS = 12 * 3600 * 1000;
const sessions = new Map<string, Session>();

/** A few attempts a minute are plenty for a person and useless for guessing. */
const attempts: number[] = [];
const MAX_ATTEMPTS = 8;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

function tokenOf(req: Request): string | null {
  const m = /(?:^|;\s*)ej_session=([0-9a-f-]{36})/.exec(req.headers.get('cookie') ?? '');
  return m ? m[1] : null;
}

export function sessionOf(req: Request): Session | null {
  const t = tokenOf(req);
  const s = t ? sessions.get(t) : undefined;
  if (!s) return null;
  if (Date.now() - s.last > IDLE_MS) {
    sessions.delete(t!);
    return null;
  }
  s.last = Date.now();
  return s;
}

export function statusOf(req: Request) {
  const s = sessionOf(req);
  return { unlocked: !!s, jev: !!s, model: s?.model ?? null, hint: s?.hint ?? null };
}

/** POST /api/unlock {key}: verify the key with one small Jev question, then open a session. */
export async function unlock(req: Request): Promise<Response> {
  const now = Date.now();
  while (attempts.length && now - attempts[0] > 60_000) attempts.shift();
  if (attempts.length >= MAX_ATTEMPTS)
    return json({ ok: false, reason: 'Too many attempts. Wait a minute and try again.' }, 429);
  attempts.push(now);

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
    const token = randomUUID();
    sessions.set(token, {
      client: new JevClient({ apiKey: key, model }),
      model,
      hint: key.slice(-4),
      verifiedMs: Math.round(r.latencyMs),
      last: Date.now(),
    });
    return json({ ok: true, model, hint: key.slice(-4), latencyMs: Math.round(r.latencyMs), german }, 200, {
      'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
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

/** POST /api/lock: forget this session's key. */
export function lock(req: Request): Response {
  const t = tokenOf(req);
  if (t) sessions.delete(t);
  return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
}
