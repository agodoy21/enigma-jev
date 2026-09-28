/**
 * Scan-and-climb, ciphertext only (Gillogly 1995; Weierud & Sullivan 2005).
 *
 * Every wheel order × start position is tried with rings at A and no plugs and
 * scored by index of coincidence; survivors get their ring turnovers and a
 * plugboard climb. The IoC signal fades as plugs are added: with 10 pairs the
 * right rotor setting is barely distinguishable from noise, which is why
 * 10-plug traffic needs the Bombe (./bombe.ts). With a known plugboard and
 * rings (the daily key) the same scan recovers the message key directly.
 */
import { parsePlugboard } from '../enigma/machine.js';
import type { LanguageModel } from '../lang/ngrams.js';
import {
  compile,
  identity,
  iocSum,
  NEXT,
  polish,
  type SearchResult,
  type Setting,
  scrambler,
  TopN,
  toLetters,
  triScore,
  type WheelOrder,
} from './engine.js';

export interface ScanSpace {
  readonly orders: readonly WheelOrder[];
  /** Known rings of the three stepping rotors, left to right. */
  readonly rings?: readonly number[];
  /** Known greek wheel offset (position − ring). */
  readonly greekOffset?: number;
  readonly plugboard?: string;
  readonly maxPlugs?: number;
}

export interface ScanOptions {
  readonly keep?: number;
  readonly climb?: number;
  readonly refine?: number;
  readonly onProgress?: (stage: string, done: number, total: number) => void;
}

export function scanAndClimb(
  cipherText: string,
  space: ScanSpace,
  lm: LanguageModel,
  opts: ScanOptions = {},
): SearchResult {
  const cipher = toLetters(cipherText),
    n = cipher.length;
  const knownPlug = space.plugboard !== undefined ? parsePlugboard(space.plugboard) : undefined;
  const plug = knownPlug ?? identity();
  const rings = (space.rings ? [...space.rings] : [0, 0, 0]) as [number, number, number];
  const counts = new Int32Array(26),
    out = new Uint8Array(n);
  // With the plugboard known the trigram model can judge directly; otherwise only IoC survives the plugs.
  const score = knownPlug ? (o: Uint8Array) => triScore(lm.tri, o) : (o: Uint8Array) => iocSum(o, counts);
  const top = new TopN<Setting>(opts.keep ?? (knownPlug ? 50 : 1500));
  const pc = Uint8Array.from(cipher, c => plug[c]);
  const ms: Record<string, number> = {};
  let t0 = performance.now(),
    examined = 0;

  for (let oi = 0; oi < space.orders.length; oi++) {
    const comp = compile(space.orders[oi]);
    const { rf, rb, core, notchM, notchR } = comp;
    const greeks = comp.order.greek
      ? space.greekOffset === undefined
        ? [...Array(26).keys()]
        : [space.greekOffset]
      : [0];
    const [rl, rm, rr] = rings;
    for (const g of greeks) {
      const gBase = g * 17576;
      for (let p0 = 0; p0 < 26; p0++)
        for (let p1 = 0; p1 < 26; p1++)
          for (let p2 = 0; p2 < 26; p2++) {
            let pl = p0,
              pm = p1,
              pr = p2;
            let sl = (pl - rl + 26) % 26,
              sm = (pm - rm + 26) % 26,
              sr = (pr - rr + 26) % 26;
            let cb = gBase + (sl * 26 + sm) * 26;
            for (let i = 0; i < n; i++) {
              if (notchM[pm]) {
                pm = NEXT[pm];
                pl = NEXT[pl];
                sm = NEXT[sm];
                sl = NEXT[sl];
                cb = gBase + (sl * 26 + sm) * 26;
              } else if (notchR[pr]) {
                pm = NEXT[pm];
                sm = NEXT[sm];
                cb = gBase + (sl * 26 + sm) * 26;
              }
              pr = NEXT[pr];
              sr = NEXT[sr];
              const rs = sr * 26;
              out[i] = plug[rb[rs + core[cb + rf[rs + pc[i]]]]];
            }
            examined++;
            const s = score(out);
            if (s > top.floor)
              top.push({
                comp,
                g,
                rings,
                pos: [p0, p1, p2],
                plug,
                score: s,
                via: knownPlug ? 'message-key scan' : 'ioc scan',
              });
          }
    }
    opts.onProgress?.('scan', oi + 1, space.orders.length);
  }
  ms.scan = performance.now() - t0;
  t0 = performance.now();
  let seeds = top.sorted();
  if (!space.rings && !knownPlug) {
    // Rings at A put the middle rotor's step in the wrong place; find each survivor's best turnover before climbing.
    const ioc = (st: Setting) => {
      const S = scrambler(st.comp, st.g, st.rings, st.pos, n);
      for (let i = 0; i < n; i++) out[i] = S[i * 26 + cipher[i]];
      return iocSum(out, counts);
    };
    const turn = (st: Setting, which: 1 | 2): Setting => {
      let best = st,
        bestScore = ioc(st);
      for (let d = 1; d < 26; d++) {
        const r = [...st.rings] as [number, number, number],
          p = [...st.pos] as [number, number, number];
        r[which] = (r[which] + d) % 26;
        p[which] = (p[which] + d) % 26;
        const t = { ...st, rings: r, pos: p },
          s = ioc(t);
        if (s > bestScore) {
          best = t;
          bestScore = s;
        }
      }
      return { ...best, score: bestScore };
    };
    seeds = seeds.map(st => turn(turn(st, 2), 1)).sort((a, b) => b.score - a.score);
  }
  ms.rings = performance.now() - t0;
  t0 = performance.now();
  const candidates = polish(seeds, cipher, lm, {
    climb: opts.climb,
    refine: opts.refine,
    maxPlugs: space.maxPlugs,
    knownPlug,
    knownRings: !!space.rings,
    iocFirst: true,
    onProgress: opts.onProgress,
  });
  ms.polish = performance.now() - t0;
  return { candidates, examined, ms };
}
