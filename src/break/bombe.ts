/**
 * A software Turing–Welchman Bombe.
 *
 * A crib is a guess at some plaintext and where it sits. Each crib letter
 * pairs with its cipher letter through that position's scrambler, which gives
 * the constraint plug(C_j) = S_j(plug(P_j)). The menu is the graph of those
 * pairs. For every rotor setting the Bombe assumes a partner h for the menu's
 * busiest letter and propagates. With Welchman's diagonal board (a plug is
 * symmetric), a wrong setting almost always contradicts itself. A setting
 * with a consistent hypothesis is a "stop". Each stop comes with part of the
 * plugboard, and ./engine.ts `polish` finishes the plugboard and rings.
 *
 * Rings are unknown, so the middle rotor may step inside the crib.
 * `turnovers: 'all'` also tries each crib letter as the step point, as
 * Bletchley did by running a menu with the middle rotor stepped.
 */

import { ROTORS } from '../enigma/wiring.js';
import type { LanguageModel } from '../lang/ngrams.js';
import {
  type Compiled,
  compile,
  polish,
  type SearchResult,
  type Setting,
  shiftsFor,
  TopN,
  toLetters,
  type WheelOrder,
} from './engine.js';

export interface BombeSpace {
  readonly orders: readonly WheelOrder[];
  readonly greekOffset?: number;
  readonly maxPlugs?: number;
}

export interface BombeOptions {
  /** 'none' assumes no middle-rotor step inside the crib; 'all' also tries each crib letter. */
  readonly turnovers?: 'none' | 'all';
  /** Stops kept, by quick score, for the plugboard climb. */
  readonly keep?: number;
  readonly climb?: number;
  readonly refine?: number;
  readonly onProgress?: (stage: string, done: number, total: number) => void;
  /** Diagnostics: every stop, with its quick score. */
  readonly onStop?: (stop: {
    order: WheelOrder;
    sl: number;
    sm: number;
    sr: number;
    turnover: number;
    quick: number;
    plug: Uint8Array;
    d: number;
  }) => void;
}

export interface BombeResult extends SearchResult {
  readonly stops: number;
}

/** A crib can sit where no letter would encipher to itself. */
export function cribFits(cipherText: string, crib: string, position: number): boolean {
  if (position < 0 || position + crib.length > cipherText.length) return false;
  for (let j = 0; j < crib.length; j++) if (cipherText[position + j] === crib[j]) return false;
  return true;
}

export function cribPositions(cipherText: string, crib: string): number[] {
  const out: number[] = [];
  for (let p = 0; p + crib.length <= cipherText.length; p++) if (cribFits(cipherText, crib, p)) out.push(p);
  return out;
}

/** Loops in the menu (edges − letters + components): what makes a Bombe run selective. */
export function menuLoops(cipherText: string, crib: string, position: number): number {
  const parent = [...Array(26).keys()];
  const find = (x: number): number => {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  let loops = 0;
  for (let j = 0; j < crib.length; j++) {
    const a = find(crib.charCodeAt(j) - 65),
      b = find(cipherText.charCodeAt(position + j) - 65);
    if (a === b) loops++;
    else parent[a] = b;
  }
  return loops;
}

export function bombe(
  cipherText: string,
  crib: string,
  position: number,
  space: BombeSpace,
  lm: LanguageModel,
  opts: BombeOptions = {},
): BombeResult {
  if (!cribFits(cipherText, crib, position))
    throw new Error(`Crib ${crib} cannot sit at ${position}: a letter would encipher to itself`);
  const cipher = toLetters(cipherText),
    n = crib.length,
    N = cipher.length;
  const P = toLetters(crib),
    C = cipher.subarray(position, position + n);

  // Menu adjacency: letter → (other letter, crib index). Both directions, S_j being an involution.
  const adj: Array<Array<[number, number]>> = Array.from({ length: 26 }, () => []);
  for (let j = 0; j < n; j++) {
    adj[P[j]].push([C[j], j]);
    adj[C[j]].push([P[j], j]);
  }
  const test = adj.reduce((best, e, i) => (e.length > adj[best].length ? i : best), 0);
  const adjTo = adj.map(e => Int8Array.from(e, x => x[0])),
    adjJ = adj.map(e => Int8Array.from(e, x => x[1]));

  const turnovers = opts.turnovers === 'all' ? [n, ...Array.from({ length: n - 1 }, (_, i) => i + 1)] : [n];
  const top = new TopN<Stop>(opts.keep ?? 400);
  const map = new Int8Array(26),
    stack = new Int8Array(64),
    rs = new Int32Array(n),
    cb = new Int32Array(n);
  const scorer = new RingFreeScorer(cipher, position, lm);
  let examined = 0,
    stops = 0;
  const t0 = performance.now();

  const total = space.orders.length;
  for (let oi = 0; oi < total; oi++) {
    const comp = compile(space.orders[oi]);
    const { rf, rb, core } = comp;
    const period = 26 / ROTORS[comp.order.rotors[2]].notches.length;
    const greeks = comp.order.greek
      ? space.greekOffset === undefined
        ? [...Array(26).keys()]
        : [space.greekOffset]
      : [0];
    for (const t of turnovers) {
      // Steps fall on crib-relative letters u ≡ d (mod period). Allowed: exactly one step inside the crib, at t;
      // or none, which needs d ≥ n, or d = 0 (a step just before the crib) with the next one past it.
      const valid = new Uint8Array(period);
      if (t < n) {
        if (t - period < 1 && t + period >= n) valid[t % period] = 1;
      } else for (let d = 0; d < period; d++) valid[d] = (d === 0 ? period >= n : d >= n) ? 1 : 0;
      if (!valid.some(Boolean)) continue;
      for (const g of greeks)
        for (let sl = 0; sl < 26; sl++)
          for (let sm = 0; sm < 26; sm++)
            for (let sr = 0; sr < 26; sr++) {
              examined++;
              for (let j = 0; j < n; j++) {
                rs[j] = ((sr + j) % 26) * 26;
                cb[j] = g * 17576 + (sl * 26 + ((sm + (j >= t ? 1 : 0)) % 26)) * 26;
              }
              for (let h = 0; h < 26; h++) {
                map.fill(-1);
                // assign(x, v): plug(x) = v and, by the diagonal board, plug(v) = x.
                let sp = 0,
                  ok = true;
                map[test] = h;
                map[h] = test;
                stack[sp++] = test;
                if (h !== test) stack[sp++] = h;
                while (sp && ok) {
                  const x = stack[--sp],
                    v = map[x],
                    to = adjTo[x],
                    js = adjJ[x];
                  for (let e = 0; e < to.length; e++) {
                    const j = js[e],
                      y = to[e];
                    const w = rb[rs[j] + core[cb[j] + rf[rs[j] + v]]];
                    const my = map[y],
                      mw = map[w];
                    if (my === -1 && mw === -1) {
                      map[y] = w;
                      map[w] = y;
                      stack[sp++] = y;
                      if (w !== y) stack[sp++] = w;
                    } else if (my !== w || mw !== y) {
                      ok = false;
                      break;
                    }
                  }
                }
                if (!ok) continue;
                stops++;
                const plug = new Uint8Array(26).map((_, i) => (map[i] >= 0 ? map[i] : i));
                const q = scorer.best(comp, period, valid, g, sl, sm, sr, plug);
                opts.onStop?.({ order: comp.order, sl, sm, sr, turnover: t, quick: q.score, plug, d: q.d });
                if (q.score > top.floor)
                  top.push({
                    comp,
                    g,
                    sl,
                    sm,
                    sr,
                    t,
                    d: q.d,
                    plug,
                    score: q.score,
                    locked: Uint8Array.from(map, v => (v >= 0 ? 1 : 0)),
                  });
              }
            }
    }
    opts.onProgress?.('bombe', oi + 1, total);
  }
  const ms: Record<string, number> = { bombe: performance.now() - t0 };
  const t1 = performance.now();
  const seeds: Setting[] = [];
  for (const st of top.sorted()) {
    const seed = seedFor(st.comp, position, N, st.sl, st.sm, st.sr, st.t, n, st.d);
    if (seed)
      seeds.push({
        comp: st.comp,
        g: st.g,
        rings: seed.rings,
        pos: seed.pos,
        plug: st.plug,
        score: st.score,
        via: `bombe ${crib}@${position}`,
        locked: st.locked,
      });
  }
  const candidates = polish(seeds, cipher, lm, {
    climb: opts.climb ?? 150,
    refine: opts.refine ?? 8,
    maxPlugs: space.maxPlugs ?? 10,
  });
  ms.polish = performance.now() - t1;
  return { candidates, examined, stops, ms };
}

interface Stop {
  comp: Compiled;
  g: number;
  sl: number;
  sm: number;
  sr: number;
  t: number;
  d: number;
  plug: Uint8Array;
  score: number;
  locked: Uint8Array;
}

/**
 * Trigram score of a stop's trial decryption, maximised over every ring
 * turnover at once.
 *
 * Right-ring choices move only where the middle rotor steps. With the step
 * residue d (steps before crib-relative letters u ≡ d mod P; P = 26, or 13
 * for a two-notch rotor), letter u sits one middle offset higher than its
 * base exactly when 1 ≤ d ≤ R(u). So each letter is decrypted both ways and
 * its trigram gain is filed under R(u). A suffix sum then scores every d.
 * Left-rotor steps are ignored here; `polish` handles them exactly.
 */
class RingFreeScorer {
  private readonly rel = new Map<number, { base: Int16Array; R: Uint8Array }>();
  private readonly uR: Uint8Array;
  private readonly d0: Uint8Array;
  private readonly d1: Uint8Array;
  private readonly delta = new Float64Array(26);
  constructor(
    private readonly cipher: Uint8Array,
    private readonly p: number,
    private readonly lm: LanguageModel,
  ) {
    const N = cipher.length;
    this.uR = Uint8Array.from({ length: N }, (_, i) => (((i - p) % 26) + 26) % 26);
    this.d0 = new Uint8Array(N);
    this.d1 = new Uint8Array(N);
  }
  private layout(P: number) {
    let r = this.rel.get(P);
    if (!r) {
      const N = this.cipher.length,
        base = new Int16Array(N),
        R = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const u = i - this.p;
        if (u >= 0) {
          base[i] = Math.floor(u / P);
          R[i] = u % P;
        } else {
          const w = -u;
          base[i] = -Math.floor((w - 1) / P) - 1;
          R[i] = P - 1 - ((w - 1) % P);
        }
      }
      r = { base, R };
      this.rel.set(P, r);
    }
    return r;
  }
  best(
    comp: Compiled,
    P: number,
    valid: Uint8Array,
    g: number,
    sl: number,
    sm: number,
    sr: number,
    plug: Uint8Array,
  ): { score: number; d: number } {
    const { base, R } = this.layout(P),
      { rf, rb, core } = comp,
      { cipher, uR, d0, d1, delta } = this,
      tri = this.lm.tri;
    const N = cipher.length,
      gl = g * 17576 + sl * 676;
    for (let i = 0; i < N; i++) {
      const rsh = ((sr + uR[i]) % 26) * 26,
        x = rf[rsh + plug[cipher[i]]];
      const m0 = (((sm + base[i]) % 26) + 26) % 26,
        m1 = m0 === 25 ? 0 : m0 + 1;
      d0[i] = plug[rb[rsh + core[gl + m0 * 26 + x]]];
      d1[i] = plug[rb[rsh + core[gl + m1 * 26 + x]]];
    }
    delta.fill(0);
    let t0 = 0;
    for (let i = 2; i < N; i++) {
      const a = tri[(d0[i - 2] * 26 + d0[i - 1]) * 26 + d0[i]],
        b = tri[(d1[i - 2] * 26 + d1[i - 1]) * 26 + d1[i]];
      t0 += a;
      delta[R[i]] += b - a;
    }
    let best = valid[0] ? t0 : -Infinity,
      bestD = 0,
      acc = 0;
    for (let d = P - 1; d >= 1; d--) {
      acc += delta[d];
      if (valid[d] && t0 + acc > best) {
        best = t0 + acc;
        bestD = d;
      }
    }
    return { score: best, d: bestD };
  }
}

/**
 * Message-start rings and positions that reproduce the stop's shifts over the
 * crib: left sl, middle sm stepping before crib letter t (none when t = n),
 * right sr + j, with the middle rotor's steps at crib-relative residue d
 * (the ring the quick score chose). The left ring is taken as A.
 */
function seedFor(
  comp: Compiled,
  p: number,
  N: number,
  sl: number,
  sm: number,
  sr: number,
  t: number,
  n: number,
  d: number,
): { rings: [number, number, number]; pos: [number, number, number] } | null {
  const len = Math.min(N, p + n);
  for (let rr = 0; rr < 26; rr++) {
    const pr = (((sr + rr - p - 1) % 26) + 26) % 26;
    // The right rotor alone decides where the middle one steps (double steps aside): check that first.
    let fits = !!comp.notchR[(((pr + p + d) % 26) + 26) % 26];
    for (let j = 1; j < n && fits; j++) if (!!comp.notchR[(pr + p + j) % 26] !== (j === t)) fits = false;
    if (!fits) continue;
    // The middle ring matters too: with the wrong one the middle rotor can meet its own notch and double-step.
    for (let rm = 0; rm < 26; rm++)
      for (let dl = 0; dl < 2; dl++)
        for (let pm = 0; pm < 26; pm++) {
          const pl = (sl - dl + 26) % 26;
          const s = shiftsFor(comp, [0, rm, rr], [pl, pm, pr], len);
          let match = true;
          for (let j = 0; j < n && match; j++) {
            const i = p + j;
            if (s.sl[i] !== sl || s.sr[i] !== (sr + j) % 26 || s.sm[i] !== (sm + (j >= t ? 1 : 0)) % 26) match = false;
          }
          if (match) return { rings: [0, rm, rr], pos: [pl, pm, pr] };
        }
  }
  return null;
}
