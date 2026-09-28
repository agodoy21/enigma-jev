import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { historicalCases } from '../src/backtest/cases.js';
import { breakStream } from '../src/web/break-stream.js';
import type { BreakEvent } from '../src/web/events.js';
import { startServer } from '../src/web/server.js';

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

  test('unlock verifies the key with TypeSafe, sets an HttpOnly cookie, and lock forgets it', async () => {
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
    await realFetch(url('/api/lock'), { method: 'POST', headers: { cookie: session } });
    expect(await realFetch(url('/api/status'), { headers: { cookie: session } }).then(r => r.json())).toMatchObject({
      unlocked: false,
    });
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
