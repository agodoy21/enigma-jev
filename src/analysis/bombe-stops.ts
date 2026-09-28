/**
 * Validates the software Bombe's test register against published stop counts.
 *
 *   bun run src/analysis/bombe-stops.ts      → reports/bombe-stops.json
 *
 * Weinbaum (2025, ch. 4) simulated Turing–Welchman Bombe runs without the
 * diagonal board for menus made of one or two closed loops of given lengths,
 * and derived the stop counts from permutation parity and a generalisation of
 * Dixon's theorem. This script builds random menus of the same shapes, runs
 * this project's register (src/break/register.ts) over all 17,576 start
 * positions on real Enigma I scramblers, and reports mean stops with a 95%
 * interval beside his figures, and beside Turing's own estimate of 26^(4−c)
 * for c closures. It also measures two other quantities he states:
 *
 *   - the share of settings that can produce a 1–4 "female" (the event
 *     Zygalski's sheets record), against his uniform-model value of 0.405;
 *   - the D-Day Biscay weather crib, where only one alignment survives.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, scrambler } from '../break/engine.js';
import { clashes, DemoBombe, type Edge, liveCount } from '../break/register.js';

const ROTORS = ['I', 'II', 'III', 'IV', 'V'];
let seed = 1940;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (n: number) => Math.floor(rand() * n);

/** A closed loop of `len` distinct letters, avoiding letters and positions already used, optionally through `through`. */
function loop(len: number, used: Edge[] = [], through?: number): Edge[] {
  const taken = new Set(used.flatMap(e => [e.a, e.b])),
    at = new Set(used.map(e => e.i));
  const letters: number[] = through === undefined ? [] : [through];
  while (letters.length < len) {
    const x = int(26);
    if (!letters.includes(x) && !taken.has(x)) letters.push(x);
  }
  return letters.map((a, k) => {
    let i: number;
    do i = int(40);
    while (at.has(i));
    at.add(i);
    return { a, b: letters[(k + 1) % len], i };
  });
}

function stopsFor(edges: Edge[], test: number, diagonal: boolean): number {
  const pool = [...ROTORS],
    rotors: string[] = [];
  while (rotors.length < 3) rotors.push(pool.splice(int(pool.length), 1)[0]);
  const bombe = new DemoBombe(
    { reflector: 'B', rotors, rings: [int(26), int(26), int(26)], positions: [0, 0, 0], plugboard: '' },
    edges,
  );
  const hyp = int(26);
  let stops = 0;
  for (let p = 0; p < 17576; p++) if (liveCount(bombe.test(p, test, hyp, diagonal)) < 26) stops++;
  return stops;
}

const summary = (xs: number[]) => {
  const n = xs.length,
    mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: Math.round(mean * 10) / 10, ci95: Math.round(((1.96 * sd) / Math.sqrt(n)) * 10) / 10 };
};

// Weinbaum (2025), tables 4.1–4.3 (Bouchaudy simulation, 95% intervals).
const W1: Record<number, [number, number]> = {
  2: [17576, 0],
  3: [16243.78, 6.91],
  4: [17576, 0],
  5: [16220.57, 6.66],
  6: [17576, 0],
  7: [16224.37, 6.63],
};
const W2: Record<string, [number, number]> = {
  '2+2': [781.08, 4.99],
  '2+3': [749.89, 3.58],
  '3+3': [704.02, 1.73],
  '3+5': [706.84, 1.69],
};

const t0 = performance.now();
const singleLoop = Object.keys(W1)
  .map(Number)
  .map(len => {
    const runs = Array.from({ length: len % 2 ? 24 : 4 }, () => {
      const e = loop(len);
      return stopsFor(e, e[0].a, false);
    });
    return { length: len, ours: summary(runs), weinbaum: { mean: W1[len][0], ci95: W1[len][1] }, turing: 26 ** 3 };
  });
const twoLoops = Object.keys(W2).map(k => {
  const [a, b] = k.split('+').map(Number);
  const none: number[] = [],
    diag: number[] = [];
  for (let r = 0; r < 24; r++) {
    const e1 = loop(a),
      e2 = loop(b, e1, e1[0].a),
      edges = [...e1, ...e2];
    none.push(stopsFor(edges, e1[0].a, false));
    diag.push(stopsFor(edges, e1[0].a, true));
  }
  return {
    lengths: [a, b],
    ours: summary(none),
    weinbaum: { mean: W2[k][0], ci95: W2[k][1] },
    turing: 26 ** 2,
    withDiagonalBoard: summary(diag),
  };
});

// The chance that a setting can produce a 1–4 female: π1·π4 has a fixed point (no plugboard, rings AAA).
const fact = (n: number) => {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};
const choose = (n: number, k: number) => fact(n) / (fact(k) * fact(n - k));
let model = 0;
for (let k = 1; k <= 13; k++)
  model += ((-1) ** (k + 1) * choose(13, k) * (2 ** k * fact(13) * fact(26 - 2 * k))) / (fact(13 - k) * fact(26));
const perOrder: number[] = [];
for (const l of ROTORS)
  for (const m of ROTORS)
    for (const r of ROTORS) {
      if (l === m || m === r || l === r) continue;
      const comp = compile({ reflector: 'B', greek: null, rotors: [l, m, r] });
      let yes = 0;
      for (let p = 0; p < 17576; p++) {
        const S = scrambler(comp, 0, [0, 0, 0], [(p / 676) | 0, ((p / 26) | 0) % 26, p % 26], 4);
        for (let x = 0; x < 26; x++)
          if (S[S[78 + x]] === x) {
            yes++;
            break;
          }
      }
      perOrder.push(yes / 17576);
    }
const female = {
  model: Math.round(model * 1e4) / 1e4,
  measured: Math.round((perOrder.reduce((a, b) => a + b, 0) / perOrder.length) * 1e4) / 1e4,
  min: Math.round(Math.min(...perOrder) * 1e4) / 1e4,
  max: Math.round(Math.max(...perOrder) * 1e4) / 1e4,
  orders: perOrder.length,
  sheetsFor1Hole: Math.log(1 / 676) / Math.log(perOrder.reduce((a, b) => a + b, 0) / perOrder.length),
};

// D-Day: the Biscay weather crib (Ellsbury, via Weinbaum 2025).
const ct = 'QFZWRWIVTYRESXBFOGKUHQBAISEZ',
  crib = 'WETTERVORHERSAGEBISKAYA';
const dday = {
  ciphertext: ct,
  crib,
  alignments: Array.from({ length: ct.length - crib.length + 1 }, (_, at) => ({
    at,
    clashes: clashes(ct, crib, at).map(j => crib[j]),
  })),
};

const out = {
  generatedAt: new Date().toISOString(),
  seconds: Math.round((performance.now() - t0) / 1000),
  source: 'Weinbaum, J. (2025) Action This Day, Dartmouth College MS thesis, ch. 4',
  singleLoop,
  twoLoops,
  female,
  dday,
};
const dir = join(import.meta.dir, '..', '..', 'reports');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'bombe-stops.json'), JSON.stringify(out, null, 2));
console.log(
  JSON.stringify({
    singleLoop: singleLoop.map(s => [s.length, s.ours.mean, s.ours.ci95, s.weinbaum.mean]),
    twoLoops: twoLoops.map(t => [
      t.lengths.join('+'),
      t.ours.mean,
      t.ours.ci95,
      t.weinbaum.mean,
      t.withDiagonalBoard.mean,
    ]),
    female,
    dday: dday.alignments.map(a => `${a.at}:${a.clashes.join('') || 'ok'}`),
    seconds: out.seconds,
  }),
);
