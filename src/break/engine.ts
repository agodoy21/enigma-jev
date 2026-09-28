/**
 * Shared Enigma search machinery: compiled rotor tables, per-letter scrambler
 * permutations, plugboard hill-climbing and ring-turnover refinement.
 *
 * Two attacks feed it (see ./climb.ts and ./bombe.ts). Both produce "seeds",
 * rotor settings with a possibly partial plugboard, and `polish` turns seeds
 * into ranked candidate decryptions:
 *
 *   plugs   hill-climb the plugboard, on IoC first when starting from nothing,
 *           then on German trigrams (Weierud & Sullivan 2005)
 *   rings   retry right and middle ring turnovers with plugs in place, re-climb
 *
 * All tables are 0-based letters. A greek wheel never steps, so only its
 * offset (position − ring) matters; it is searched as a position with ring A.
 */

import { type EnigmaKey, plugboardString } from '../enigma/machine.js';
import { GREEK, idx, mod26, REFLECTORS, ROTORS } from '../enigma/wiring.js';
import type { LanguageModel } from '../lang/ngrams.js';

export interface WheelOrder {
  readonly reflector: string;
  readonly greek: string | null;
  readonly rotors: readonly [string, string, string];
}

export interface Candidate {
  readonly key: EnigmaKey;
  readonly plaintext: string;
  /** Mean trigram log-probability per letter. */
  readonly score: number;
  /** How the candidate was found, e.g. "bombe WETTERVORHERSAGE@0". */
  readonly via: string;
  /** The plugboard the search started from (a Bombe stop's partial board) and the letters it fixed. */
  readonly seedPlugboard?: string;
  readonly locked?: string;
}

export interface SearchResult {
  readonly candidates: Candidate[];
  readonly examined: number;
  readonly ms: Record<string, number>;
}

export interface Compiled {
  readonly order: WheelOrder;
  readonly rf: Uint8Array;
  readonly rb: Uint8Array;
  readonly core: Uint8Array;
  readonly notchR: Uint8Array;
  readonly notchM: Uint8Array;
}

export interface Setting {
  readonly comp: Compiled;
  readonly g: number;
  readonly rings: readonly [number, number, number];
  readonly pos: readonly [number, number, number];
  readonly plug: Uint8Array;
  readonly score: number;
  readonly via: string;
  /** Letters whose plug partner is fixed (a Bombe stop's menu letters): the climb leaves them alone. */
  readonly locked?: Uint8Array;
  /** The plugboard before any climb. */
  readonly seedPlug?: Uint8Array;
}

export const identity = () => new Uint8Array(26).map((_, i) => i);
export const NEXT = Uint8Array.from({ length: 26 }, (_, i) => (i + 1) % 26);
const fromWiring = (w: string) => Uint8Array.from(w, c => idx(c));
const inverseOf = (t: Uint8Array) => {
  const inv = new Uint8Array(26);
  for (let i = 0; i < 26; i++) inv[t[i]] = i;
  return inv;
};
const through = (t: Uint8Array, c: number, s: number) => mod26(t[(c + s) % 26] - s);

const compiledCache = new Map<string, Compiled>();
/** Right rotor forward/back tables by shift, and the fixed "core" (middle, left, greek, reflector and back) by (greek, left, middle) shift. */
export function compile(order: WheelOrder): Compiled {
  const cacheKey = `${order.reflector}|${order.greek}|${order.rotors.join(',')}`;
  const hit = compiledCache.get(cacheKey);
  if (hit) return hit;
  const [L, M, R] = order.rotors.map(r => fromWiring(ROTORS[r].wiring));
  const [Li, Mi, Ri] = [L, M, R].map(inverseOf);
  const refl = fromWiring(REFLECTORS[order.reflector]);
  const G = order.greek ? fromWiring(GREEK[order.greek]) : null,
    Gi = G ? inverseOf(G) : null;
  const rf = new Uint8Array(676),
    rb = new Uint8Array(676);
  for (let s = 0; s < 26; s++)
    for (let c = 0; c < 26; c++) {
      rf[s * 26 + c] = through(R, c, s);
      rb[s * 26 + c] = through(Ri, c, s);
    }
  const greeks = G ? 26 : 1;
  const core = new Uint8Array(greeks * 17576);
  for (let g = 0; g < greeks; g++)
    for (let sl = 0; sl < 26; sl++)
      for (let sm = 0; sm < 26; sm++)
        for (let y = 0; y < 26; y++) {
          let c = through(M, y, sm);
          c = through(L, c, sl);
          if (G) c = through(G, c, g);
          c = refl[c];
          if (Gi) c = through(Gi, c, g);
          c = through(Li, c, sl);
          c = through(Mi, c, sm);
          core[((g * 26 + sl) * 26 + sm) * 26 + y] = c;
        }
  const notch = (r: string) => {
    const n = new Uint8Array(26);
    for (const ch of ROTORS[r].notches) n[idx(ch)] = 1;
    return n;
  };
  const comp = { order, rf, rb, core, notchR: notch(order.rotors[2]), notchM: notch(order.rotors[1]) };
  compiledCache.set(cacheKey, comp);
  return comp;
}

/** Rotor shifts (window position − ring) used for each letter, with exact double stepping. */
export function shiftsFor(
  comp: Compiled,
  rings: readonly number[],
  pos: readonly number[],
  n: number,
): { sl: Uint8Array; sm: Uint8Array; sr: Uint8Array } {
  const sl = new Uint8Array(n),
    sm = new Uint8Array(n),
    sr = new Uint8Array(n);
  let pl = pos[0],
    pm = pos[1],
    pr = pos[2];
  for (let i = 0; i < n; i++) {
    if (comp.notchM[pm]) {
      pm = NEXT[pm];
      pl = NEXT[pl];
    } else if (comp.notchR[pr]) pm = NEXT[pm];
    pr = NEXT[pr];
    sl[i] = mod26(pl - rings[0]);
    sm[i] = mod26(pm - rings[1]);
    sr[i] = mod26(pr - rings[2]);
  }
  return { sl, sm, sr };
}

/** Per-letter scrambler permutations S_i: plaintext_i = plug[S_i[plug[cipher_i]]]. */
export function scrambler(
  comp: Compiled,
  g: number,
  rings: readonly number[],
  pos: readonly number[],
  n: number,
): Uint8Array {
  const S = new Uint8Array(n * 26);
  const { sl, sm, sr } = shiftsFor(comp, rings, pos, n);
  for (let i = 0; i < n; i++) {
    const base = g * 17576 + (sl[i] * 26 + sm[i]) * 26,
      rs = sr[i] * 26;
    for (let x = 0; x < 26; x++) S[i * 26 + x] = comp.rb[rs + comp.core[base + comp.rf[rs + x]]];
  }
  return S;
}

export function iocSum(out: Uint8Array, counts: Int32Array): number {
  counts.fill(0);
  for (let i = 0; i < out.length; i++) counts[out[i]]++;
  let s = 0;
  for (let i = 0; i < 26; i++) s += counts[i] * (counts[i] - 1);
  return s;
}

export function triScore(tri: Float64Array, out: Uint8Array): number {
  let s = 0;
  for (let i = 2; i < out.length; i++) s += tri[(out[i - 2] * 26 + out[i - 1]) * 26 + out[i]];
  return s;
}

/** Bounded best-N list (min-heap on score). */
export class TopN<T extends { score: number }> {
  readonly items: T[] = [];
  constructor(readonly n: number) {}
  get floor(): number {
    return this.items.length < this.n ? -Infinity : this.items[0].score;
  }
  push(item: T): void {
    const h = this.items;
    if (h.length < this.n) {
      h.push(item);
      this.up(h.length - 1);
    } else if (item.score > h[0].score) {
      h[0] = item;
      this.down(0);
    }
  }
  sorted(): T[] {
    return [...this.items].sort((a, b) => b.score - a.score);
  }
  private up(i: number) {
    const h = this.items;
    while (i) {
      const p = (i - 1) >> 1;
      if (h[p].score <= h[i].score) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  private down(i: number) {
    const h = this.items;
    for (;;) {
      const l = 2 * i + 1,
        r = l + 1;
      let m = i;
      if (l < h.length && h[l].score < h[m].score) m = l;
      if (r < h.length && h[r].score < h[m].score) m = r;
      if (m === i) return;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
}

export type Scorer = (out: Uint8Array) => number;

const pairCount = (p: Uint8Array) => {
  let k = 0;
  for (let i = 0; i < 26; i++) if (p[i] > i) k++;
  return k;
};

/** Hill-climb the plugboard for a fixed scrambler; returns the improved plug and its score. */
export function climbPlugs(
  S: Uint8Array,
  cipher: Uint8Array,
  start: Uint8Array,
  score: Scorer,
  maxPlugs: number,
  locked?: Uint8Array,
  onImprove?: (plug: Uint8Array, score: number) => void,
): { plug: Uint8Array; score: number } {
  const n = cipher.length,
    out = new Uint8Array(n);
  const evaluate = (p: Uint8Array) => {
    for (let i = 0; i < n; i++) out[i] = p[S[i * 26 + p[cipher[i]]]];
    return score(out);
  };
  let plug = Uint8Array.from(start),
    best = evaluate(plug);
  const trial = new Uint8Array(26);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < 26; i++)
      for (let j = i + 1; j < 26; j++) {
        if (locked && (locked[i] || locked[j])) continue;
        const x = plug[i],
          y = plug[j];
        // Each option rewires i and j (and their old partners) and nothing else.
        for (let opt = 0; opt < 4; opt++) {
          trial.set(plug);
          if (x === j) {
            if (opt) break;
            trial[i] = i;
            trial[j] = j;
          } else {
            trial[i] = i;
            trial[x] = x;
            trial[j] = j;
            trial[y] = y;
            if (opt === 0) {
              trial[i] = j;
              trial[j] = i;
            } else if (opt === 1) {
              if (x === i || y === j) continue;
              trial[i] = j;
              trial[j] = i;
              trial[x] = y;
              trial[y] = x;
            } else if (opt === 2) {
              if (x === i) continue;
              trial[x] = j;
              trial[j] = x;
            } else {
              if (y === j) continue;
              trial[y] = i;
              trial[i] = y;
            }
          }
          if (locked && ((x !== i && locked[x]) || (y !== j && locked[y]))) continue;
          if (pairCount(trial) > maxPlugs) continue;
          const s = evaluate(trial);
          if (s > best + 1e-9) {
            best = s;
            plug = Uint8Array.from(trial);
            improved = true;
            onImprove?.(plug, s);
          }
        }
      }
  }
  return { plug, score: best };
}

export interface PolishOptions {
  /** Seeds given a plugboard climb. */
  readonly climb?: number;
  /** Best climbed seeds given the ring-turnover refinement. */
  readonly refine?: number;
  readonly maxPlugs?: number;
  /** The plugboard is known: score it, never climb it. */
  readonly knownPlug?: Uint8Array;
  /** Rings are known: skip turnover refinement. */
  readonly knownRings?: boolean;
  /** Seeds carry no plug information: climb on IoC before trigrams. */
  readonly iocFirst?: boolean;
  readonly onProgress?: (stage: string, done: number, total: number) => void;
}

export function polish(seeds: Setting[], cipher: Uint8Array, lm: LanguageModel, opts: PolishOptions = {}): Candidate[] {
  const n = cipher.length,
    out = new Uint8Array(n),
    counts = new Int32Array(26);
  const maxPlugs = opts.maxPlugs ?? 10;
  const ioc: Scorer = o => iocSum(o, counts);
  const tri: Scorer = o => triScore(lm.tri, o);
  const decryptWith = (st: Setting, p: Uint8Array) => {
    const S = scrambler(st.comp, st.g, st.rings, st.pos, n);
    for (let i = 0; i < n; i++) out[i] = p[S[i * 26 + p[cipher[i]]]];
    return out;
  };
  const climb = (st: Setting, iocFirst: boolean): Setting => {
    if (opts.knownPlug) return { ...st, plug: opts.knownPlug, score: tri(decryptWith(st, opts.knownPlug)) };
    const S = scrambler(st.comp, st.g, st.rings, st.pos, n);
    const a = iocFirst ? climbPlugs(S, cipher, st.plug, ioc, maxPlugs, st.locked).plug : st.plug;
    const b = climbPlugs(S, cipher, a, tri, maxPlugs, st.locked);
    return { ...st, plug: b.plug, score: b.score, seedPlug: st.seedPlug ?? st.plug };
  };
  /** Same rotor offsets, other ring: only the turnover point moves. */
  const bestTurnover = (st: Setting, which: 1 | 2): Setting => {
    let best = st,
      bestScore = tri(decryptWith(st, st.plug));
    for (let d = 1; d < 26; d++) {
      const rings = [...st.rings] as [number, number, number],
        pos = [...st.pos] as [number, number, number];
      rings[which] = (rings[which] + d) % 26;
      pos[which] = (pos[which] + d) % 26;
      const t = { ...st, rings, pos },
        s = tri(decryptWith(t, st.plug));
      if (s > bestScore) {
        best = t;
        bestScore = s;
      }
    }
    return { ...best, score: bestScore };
  };

  const toClimb = seeds.slice(0, opts.climb ?? 150);
  const climbed = toClimb
    .map((st, k) => {
      if (k % 10 === 9) opts.onProgress?.('plugs', k + 1, toClimb.length);
      return climb(st, opts.iocFirst ?? false);
    })
    .sort((a, b) => b.score - a.score);
  const refineN = opts.knownRings ? 0 : (opts.refine ?? 8);
  const refined = climbed.slice(0, refineN).map(st => climb(bestTurnover(bestTurnover(st, 2), 1), false));
  const all = [...refined, ...climbed.slice(refineN)].sort((a, b) => b.score - a.score);
  return all.map(st => ({
    key: toKey(st),
    plaintext: Array.from(decryptWith(st, st.plug), c => String.fromCharCode(65 + c)).join(''),
    score: st.score / Math.max(1, n - 2),
    via: st.via,
    seedPlugboard: st.seedPlug ? plugboardString(st.seedPlug) : undefined,
    locked: st.locked ? Array.from(st.locked, (v, i) => (v ? String.fromCharCode(65 + i) : '')).join('') : undefined,
  }));
}

export function toKey(st: Pick<Setting, 'comp' | 'g' | 'rings' | 'pos' | 'plug'>): EnigmaKey {
  const o = st.comp.order;
  const plugboard = plugboardString(st.plug);
  if (o.greek)
    return {
      reflector: o.reflector,
      rotors: [o.greek, ...o.rotors],
      rings: [0, ...st.rings],
      positions: [st.g, ...st.pos],
      plugboard,
    };
  return { reflector: o.reflector, rotors: [...o.rotors], rings: [...st.rings], positions: [...st.pos], plugboard };
}

/** Every ordered choice of three distinct rotors from a set. */
export function allOrders(
  rotors: readonly string[],
  reflectors: readonly string[],
  greeks: readonly (string | null)[] = [null],
): WheelOrder[] {
  const out: WheelOrder[] = [];
  for (const reflector of reflectors)
    for (const greek of greeks)
      for (const l of rotors)
        for (const m of rotors)
          for (const r of rotors) {
            if (l !== m && m !== r && l !== r) out.push({ reflector, greek, rotors: [l, m, r] });
          }
  return out;
}

export const toLetters = (s: string) => Uint8Array.from(s, ch => ch.charCodeAt(0) - 65);
