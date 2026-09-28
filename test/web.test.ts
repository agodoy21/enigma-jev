import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { historicalCases } from '../src/backtest/cases.js';
import { handleApi } from '../src/web/api.js';
import { breakStream } from '../src/web/break-stream.js';
import type { BreakEvent } from '../src/web/events.js';
import { WorkerPool } from '../src/web/pool.js';
import { startServer } from '../src/web/server.js';
import { open, seal } from '../src/web/session.js';

const realFetch = globalThis.fetch;
/** TypeSafe answers: a stub standing in for the network; everything else goes to the real fetch. */
let typesafe: (body: { questions: Record<string, unknown> }) => Response = () => new Response('{}', { status: 500 });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('typesafe.ai')) return typesafe(JSON.parse(String(init?.body ?? '{}')));
  return realFetch(input, init);
}) as typeof fetch;

const ok = () =>
  Response.json({
    model: 'jev-1.13.0',
    usage: { input_tokens: 20, output_tokens: 4 },
    answers: { german: { type: 'noul', noul: 0.97 } },
  });

let server: ReturnType<typeof startServer>;
const url = (path: string) => new URL(path, server.url).href;
beforeAll(() => {
  server = startServer(0);
});
afterAll(() => {
  server.stop(true);
  globalThis.fetch = realFetch;
});

describe('web API', () => {
  test('status, presets and encryption answer without a key', async () => {
    expect(await realFetch(url('/api/status')).then(r => r.json())).toMatchObject({ unlocked: false });
    const { presets, cribs } = await realFetch(url('/api/presets')).then(r => r.json());
    expect(presets.length).toBeGreaterThan(0);
    expect(cribs.length).toBeGreaterThan(10);
    const enc = await realFetch(url('/api/encrypt'), {
      method: 'POST',
      body: JSON.stringify({
        key: { reflector: 'B', rotors: ['I', 'II', 'III'], rings: [0, 0, 0], positions: [0, 0, 0], plugboard: '' },
        text: 'aaaaa',
      }),
    }).then(r => r.json());
    expect(enc.ciphertext).toBe('BDZGO');
  });

  test('reports: the papers read the newest backtests and each analysis', async () => {
    const r = await realFetch(url('/api/report')).then(x => x.json());
    expect(r).toHaveProperty('main');
    for (const path of ['/api/jev-analysis', '/api/bombe-stops', '/api/judge-comparison']) {
      const res = await realFetch(url(path));
      expect([200, 404]).toContain(res.status);
      if (res.status === 404) expect((await res.json()).error).toContain('run ');
    }
  });

  test('a break needs an unlocked session', async () => {
    const r = await realFetch(url('/api/break'), {
      method: 'POST',
      body: JSON.stringify({ ciphertext: 'ABCDEFGHIJ' }),
    });
    expect(r.status).toBe(401);
  });

  test('unlock verifies the key with TypeSafe, seals it into an HttpOnly cookie, and lock clears it', async () => {
    typesafe = () => new Response('unauthorized', { status: 401 });
    const bad = await realFetch(url('/api/unlock'), { method: 'POST', body: JSON.stringify({ key: 'wrong-key-123' }) });
    expect(bad.status).toBe(401);
    expect((await realFetch(url('/api/unlock'), { method: 'POST', body: JSON.stringify({ key: 'a b' }) })).status).toBe(
      400,
    );

    typesafe = ok;
    const good = await realFetch(url('/api/unlock'), {
      method: 'POST',
      body: JSON.stringify({ key: 'test-key-abcd' }),
    });
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ ok: true, hint: 'abcd', german: 0.97 });
    const cookie = good.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    const session = cookie.split(';')[0];
    expect(await realFetch(url('/api/status'), { headers: { cookie: session } }).then(r => r.json())).toMatchObject({
      unlocked: true,
      hint: 'abcd',
    });
    // The key travels only sealed: the cookie never contains it in the clear.
    expect(cookie).not.toContain('test-key-abcd');
    const cleared = await realFetch(url('/api/lock'), { method: 'POST', headers: { cookie: session } });
    expect(cleared.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await realFetch(url('/api/status')).then(r => r.json())).toMatchObject({ unlocked: false });
  });

  test('a sealed session opens only unaltered and unexpired', async () => {
    const token = await seal({ k: 'test-key-abcd', m: 'jev-1.13.0', e: Date.now() + 60_000 });
    expect(await open(token)).toMatchObject({ k: 'test-key-abcd' });
    const [iv, ct] = token.split('.');
    const flipped = ct.slice(0, -2) + (ct.at(-2) === 'A' ? 'B' : 'A') + ct.at(-1);
    expect(await open(`${iv}.${flipped}`)).toBeNull();
    expect(await open('not-a-token')).toBeNull();
    expect(await open(await seal({ k: 'test-key-abcd', m: 'jev-1.13.0', e: Date.now() - 1 }))).toBeNull();
  });

  test('one function can serve every route: the original path arrives as ?route=', async () => {
    const status = await handleApi(new Request('http://x/api?route=status'));
    expect(await status.json()).toMatchObject({ unlocked: false });
    expect((await handleApi(new Request('http://x/api/presets'))).status).toBe(200);
    expect((await handleApi(new Request('http://x/api?route=nope'))).status).toBe(404);
    expect((await handleApi(new Request('http://x/api?route=unlock'))).status).toBe(405);
  });
});

describe('worker pool', () => {
  test('runs a Bombe step in process, in chunks, when workers are unavailable', async () => {
    process.env.ENIGMA_JEV_INLINE = '1';
    const pool = new WorkerPool();
    delete process.env.ENIGMA_JEV_INLINE;
    expect(pool.inline).toBe(true);
    const c = historicalCases().find(x => x.id === 'barbarossa-1941-part1')!;
    const seen: number[] = [];
    const r = await pool.spread(
      12,
      slice => ({
        op: 'bombe',
        ciphertext: c.ciphertext,
        machine: 'I',
        date: c.date,
        crib: c.plaintext.slice(0, 14),
        at: 0,
        turnovers: 'none',
        slice,
      }),
      p => seen.push(p.done),
    );
    expect(r.stops).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(r.candidates)).toBe(true);
    pool.terminate();
  });
});

describe('break stream', () => {
  test(
    'a historical intercept breaks from its first 14 letters, without Jev',
    async () => {
      const c = historicalCases().find(x => x.id === 'barbarossa-1941-part1')!;
      const res = breakStream(
        { ciphertext: c.ciphertext, service: 'Heer', date: c.date, crib: c.plaintext.slice(0, 14), useJev: false },
        null,
        null,
      );
      const text = await res.text();
      const events = text
        .split('\n\n')
        .filter(l => l.startsWith('data: '))
        .map(l => JSON.parse(l.slice(6)) as BreakEvent);
      const types = events.map(e => e.type);
      expect(types[0]).toBe('intercept');
      expect(types).toContain('bombe-done');
      const result = events.at(-1)!;
      expect(result.type).toBe('result');
      if (result.type !== 'result') return;
      expect(result.chosen).toBeGreaterThanOrEqual(0);
      const got = result.candidate!.plaintext;
      const same = [...c.plaintext].filter((ch, i) => got[i] === ch).length / c.plaintext.length;
      expect(same).toBeGreaterThan(0.9);
    },
    { timeout: 120_000 },
  );
});
