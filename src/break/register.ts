/**
 * The Bombe's test register, as a pure function of a menu and the scramblers.
 *
 *   menu        crib and cipher letters joined by the message positions that pair them
 *   loops       a closed loop is a test no plugboard can hide
 *   register    Turing's circuit: assume one plugboard partner, let every menu edge
 *               (and, with Welchman's diagonal board, every symmetric pair)
 *               propagate it, and count the live wires. 26 live = contradiction.
 *
 * The same code drives the research page's live figures (web/bombe-demo.ts) and
 * the stop-count validation against Weinbaum (2025) in src/analysis/bombe-stops.ts.
 */

import type { EnigmaKey } from '../enigma/machine.js';
import { type Compiled, compile, scrambler } from './engine.js';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Indices j where crib letter j sits on the same cipher letter at alignment `at`. */
export function clashes(cipher: string, crib: string, at: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < crib.length; j++) if (cipher[at + j] === crib[j]) out.push(j);
  return out;
}

/** One menu edge: plain letter a and cipher letter b are joined by the scrambler at message index i. */
export interface Edge {
  readonly a: number;
  readonly b: number;
  readonly i: number;
}

export function menuOf(cipher: string, crib: string, at: number): Edge[] {
  return [...crib].map((ch, j) => ({ a: A.indexOf(ch), b: A.indexOf(cipher[at + j]), i: at + j }));
}

/** The shortest closed loop in the menu (as edges in order), or null for a loop-free menu. */
export function shortestLoop(edges: readonly Edge[]): { letters: number[]; edges: Edge[] } | null {
  let best: { letters: number[]; edges: Edge[] } | null = null;
  // For each edge, the shortest path between its ends that avoids it closes the smallest loop through it.
  edges.forEach((cut, k) => {
    if (cut.a === cut.b) return;
    const prev = new Map<number, { from: number; e: Edge }>();
    const seen = new Set([cut.a]);
    let frontier = [cut.a];
    while (frontier.length && !seen.has(cut.b)) {
      const next: number[] = [];
      for (const v of frontier)
        edges.forEach((e, m) => {
          if (m === k) return;
          const w = e.a === v ? e.b : e.b === v ? e.a : -1;
          if (w < 0 || seen.has(w)) return;
          seen.add(w);
          prev.set(w, { from: v, e });
          next.push(w);
        });
      frontier = next;
    }
    if (!seen.has(cut.b)) return;
    const letters = [cut.b],
      path: Edge[] = [];
    for (let v = cut.b; v !== cut.a; ) {
      const p = prev.get(v)!;
      path.push(p.e);
      v = p.from;
      letters.push(v);
    }
    const loop = { letters: letters.reverse(), edges: [...path.reverse(), cut] };
    if (!best || loop.edges.length < best.edges.length) best = loop;
  });
  return best;
}

/** Is edge k on a closed loop (its ends stay connected without it)? */
export function onLoop(edges: readonly Edge[], k: number): boolean {
  const cut = edges[k],
    seen = new Set([cut.a]),
    stack = [cut.a];
  while (stack.length) {
    const v = stack.pop()!;
    edges.forEach((e, m) => {
      if (m === k) return;
      const w = e.a === v ? e.b : e.b === v ? e.a : -1;
      if (w >= 0 && !seen.has(w)) {
        seen.add(w);
        stack.push(w);
      }
    });
  }
  return seen.has(cut.b);
}

/** The Bombe's test register: the busiest letter that sits on a loop (only loops can light all 26 wires). */
export function busiest(edges: readonly Edge[]): number {
  const deg = new Array(26).fill(0),
    looped = new Array(26).fill(false);
  edges.forEach((e, k) => {
    deg[e.a]++;
    deg[e.b]++;
    if (onLoop(edges, k)) looped[e.a] = looped[e.b] = true;
  });
  const pool = looped.some(Boolean) ? deg.map((d, i) => (looped[i] ? d : -1)) : deg;
  return pool.indexOf(Math.max(...pool));
}

/**
 * Turing's circuit. Registers are 26 × 26 wires: wire (x, y) live means “x is plugged to y”.
 * Setting (test, hyp) live propagates through every menu edge; with Welchman's
 * diagonal board (x, y) also sets (y, x). Returns the live matrix.
 */
export function propagate(
  edges: readonly Edge[],
  S: Uint8Array,
  test: number,
  hyp: number,
  diagonal: boolean,
): Uint8Array {
  const live = new Uint8Array(676);
  const adj: Edge[][] = Array.from({ length: 26 }, () => []);
  for (const e of edges) {
    adj[e.a].push(e);
    if (e.b !== e.a) adj[e.b].push(e);
  }
  const stack = [test * 26 + hyp];
  live[test * 26 + hyp] = 1;
  const set = (x: number, y: number) => {
    const w = x * 26 + y;
    if (!live[w]) {
      live[w] = 1;
      stack.push(w);
    }
  };
  while (stack.length) {
    const w = stack.pop()!,
      x = (w / 26) | 0,
      y = w % 26;
    for (const e of adj[x]) set(e.a === x ? e.b : e.a, S[e.i * 26 + y]);
    if (diagonal) set(y, x);
  }
  return live;
}

export const registerOf = (live: Uint8Array, test: number) => live.subarray(test * 26, test * 26 + 26);
export const liveCount = (reg: ArrayLike<number>) => {
  let n = 0;
  for (let k = 0; k < 26; k++) n += reg[k];
  return n;
};

/** A Bombe run over all 17,576 start positions of one wheel order, rings known (a teaching simplification). */
export class DemoBombe {
  readonly comp: Compiled;
  readonly n: number;
  constructor(
    readonly key: EnigmaKey,
    readonly edges: readonly Edge[],
  ) {
    this.comp = compile({ reflector: key.reflector, greek: null, rotors: key.rotors as [string, string, string] });
    this.n = Math.max(...edges.map(e => e.i)) + 1;
  }
  scramblerAt(pos: number): Uint8Array {
    return scrambler(this.comp, 0, this.key.rings, [(pos / 676) | 0, ((pos / 26) | 0) % 26, pos % 26], this.n);
  }
  /** Live wires in the test register at start position `pos` (0 … 17,575). */
  test(pos: number, test: number, hyp: number, diagonal: boolean): Uint8Array {
    return registerOf(propagate(this.edges, this.scramblerAt(pos), test, hyp, diagonal), test);
  }
}

export const posIndex = (p: readonly number[]) => p[0] * 676 + p[1] * 26 + p[2];
export const posLetters = (pos: number) => A[(pos / 676) | 0] + A[((pos / 26) | 0) % 26] + A[pos % 26];
