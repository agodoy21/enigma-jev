import { describe, expect, test } from 'bun:test';
import type { Candidate } from '../src/break/engine.js';
import { JevApiError, JevClient } from '../src/jev/client.js';
import { cribQuestion, openingCribs, rankCribs } from '../src/jev/cribs.js';
import { judge, judgeQuestions } from '../src/jev/judge.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fake(responses: Array<(body: { questions: Record<string, unknown> } & Record<string, unknown>) => Response>) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    return responses[Math.min(i++, responses.length - 1)](body);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const client = (fetchImpl: typeof fetch) =>
  new JevClient({ apiKey: 'test', fetchImpl, sleep: async () => {}, logPath: null });
const cand = (plaintext: string): Candidate => ({
  key: { reflector: 'B', rotors: ['I', 'II', 'III'], rings: [0, 0, 0], positions: [0, 0, 0], plugboard: '' },
  plaintext,
  score: 0,
  via: 'test',
});

describe('JevClient', () => {
  test('sends state, model and typed questions; validates the answer', async () => {
    const { fetchImpl, calls } = fake([
      () =>
        json({
          model: 'jev-1.13.0',
          answers: { q: { type: 'noul', noul: 0.8 } },
          usage: { input_tokens: 10, output_tokens: 1 },
        }),
    ]);
    const res = await client(fetchImpl).evaluate('state', { q: { type: 'noul', instructions: 'p' } });
    expect(calls[0]).toEqual({
      state: 'state',
      model: 'jev-1.13.0',
      questions: { q: { type: 'noul', instructions: 'p' } },
    });
    expect(res.answers.answers.q).toEqual({ type: 'noul', noul: 0.8 });
  });

  test('retries 429 then succeeds; a 400 is final', async () => {
    const ok = json({
      model: 'jev-1.13.0',
      answers: { q: { type: 'noul', noul: 0.1 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const { fetchImpl, calls } = fake([() => json({}, 429), () => ok]);
    await client(fetchImpl).evaluate('s', { q: { type: 'noul', instructions: 'p' } });
    expect(calls.length).toBe(2);
    const bad = fake([() => json({ error: 'no' }, 400)]);
    await expect(
      client(bad.fetchImpl).evaluate('s', { q: { type: 'noul', instructions: 'p' } }),
    ).rejects.toBeInstanceOf(JevApiError);
  });
});

describe('judge', () => {
  test('maps choice and noul answers back to candidates', async () => {
    const { fetchImpl, calls } = fake([
      body => {
        const qs = body.questions;
        expect(Object.keys(qs).sort()).toEqual(['pick', 'readable_A', 'readable_B']);
        return json({
          model: 'jev-1.13.0',
          usage: { input_tokens: 5, output_tokens: 5 },
          answers: {
            pick: { type: 'choice', choice: 'B', confidence: 0.8, probabilities: { A: 0.1, B: 0.8, none: 0.1 } },
            readable_A: { type: 'noul', noul: 0.05 },
            readable_B: { type: 'noul', noul: 0.9 },
          },
        });
      },
    ]);
    const v = await judge(client(fetchImpl), 'CIPHER', [cand('QXZVKW'), cand('ANGRIFF')]);
    expect(v).toMatchObject({ pick: 1, accepted: 1, pickProbability: 0.8, readable: [0.05, 0.9] });
    expect(calls[0].state).toContain('Candidate B: ANGRIFF');
    expect(judgeQuestions(2).pick).toMatchObject({ type: 'choice' });
  });
});

describe('crib ranking', () => {
  test('orders fitting cribs by Jev probability, keeping static order on ties', async () => {
    const ct = 'Z'.repeat(40);
    const fitting = openingCribs(ct, 'Heer');
    const q = cribQuestion(fitting);
    const probabilities: Record<string, number> = Object.fromEntries(Object.keys(q.criteria).map(k => [k, 0]));
    const idx = fitting.findIndex(c => c.text === 'AUFKLX');
    probabilities[`c${idx}`] = 0.7;
    probabilities.none = 0.3;
    const { fetchImpl } = fake([
      () =>
        json({
          model: 'jev-1.13.0',
          usage: { input_tokens: 5, output_tokens: 5 },
          answers: { crib: { type: 'choice', choice: `c${idx}`, confidence: 0.7, probabilities } },
        }),
    ]);
    const r = await rankCribs(ct, { service: 'Heer', machine: 'I' }, client(fetchImpl));
    expect(r.source).toBe('jev');
    expect(r.order[0].text).toBe('AUFKLX');
    expect(r.order[1].text).toBe(fitting[0].text);
  });
});
