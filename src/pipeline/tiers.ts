/**
 * The attacks, as tiers of prior knowledge, from most known to least:
 *
 *   verify      full key known: the machine must reproduce the plaintext
 *   key         daily key known (wheel order, rings, plugs), message key unknown
 *   crib        known plaintext: the Bombe gets the message's true first 14 letters
 *               (measures the Bombe on real traffic, apart from crib choice)
 *   bombe       nothing known but the machine type; cribs tried in the given order
 *               (M4, both Bombe tiers: wheel order and greek wheel known, their offset searched)
 *   climb       ciphertext only, scan and hill-climb (not for M4)
 *
 * Pure CPU work, so it can run in a worker. Jev's parts (crib order in,
 * verdict out) happen in the caller.
 */

import { bombe, cribFits } from '../break/bombe.js';
import { scanAndClimb } from '../break/climb.js';
import { allOrders, type Candidate, type WheelOrder } from '../break/engine.js';
import { type EnigmaKey, encrypt } from '../enigma/machine.js';
import { ROTOR_SETS } from '../enigma/wiring.js';
import { german, germanness, type LanguageModel } from '../lang/ngrams.js';

export type Machine = 'I' | 'M3' | 'M4';
export type TierName = 'verify' | 'key' | 'crib' | 'bombe' | 'climb';

export interface TierResult {
  readonly tier: TierName;
  readonly candidates: Candidate[];
  readonly ms: number;
  readonly examined?: number;
  readonly note?: string;
  /** Cribs actually run through the Bombe, in order. */
  readonly cribsTried?: string[];
}

/** German-ness at or above which the search stops looking (the n-gram verdict; Jev gives its own). */
export const ACCEPT = 0.4;

/**
 * German-ness of the text a search did not force: a Bombe candidate carries its
 * crib verbatim, which would flatter a wrong key, so only the rest is scored.
 */
export function freeGermanness(c: Candidate, lm: LanguageModel = german()): number {
  const m = /^bombe (\w+)@(\d+)/.exec(c.via);
  if (!m) return germanness(lm, c.plaintext);
  const start = Number(m[2]),
    end = start + m[1].length;
  return germanness(lm, c.plaintext.slice(0, start) + c.plaintext.slice(end));
}
/** Known-plaintext crib length: long enough for loops, short enough that two-notch rotors step at most once inside it (period 13). */
export const KNOWN_CRIB = 14;

export function reflectorsFor(machine: Machine, date?: string): string[] {
  if (machine === 'M4') return ['B-thin', 'C-thin'];
  const year = Number(date?.slice(0, 4));
  return machine === 'I' && year && year < 1937 ? ['A'] : ['B'];
}

export function ordersFor(machine: Machine, date?: string, reflectors = reflectorsFor(machine, date)): WheelOrder[] {
  if (machine === 'M4') return allOrders(ROTOR_SETS.M4, reflectors, ['Beta', 'Gamma']);
  return allOrders(ROTOR_SETS[machine], reflectors);
}

export function knownOrder(key: EnigmaKey): WheelOrder {
  const four = key.rotors.length === 4;
  const r = key.rotors.slice(four ? 1 : 0) as [string, string, string];
  return { reflector: key.reflector, greek: four ? key.rotors[0] : null, rotors: r };
}

const best = (c: Candidate[]) => c[0];
const top = (c: Candidate[], n = 6) => c.slice(0, n);

export function runVerify(ct: string, key: EnigmaKey): TierResult {
  const t = performance.now();
  const plaintext = encrypt(key, ct);
  return { tier: 'verify', candidates: [{ key, plaintext, score: 0, via: 'known key' }], ms: performance.now() - t };
}

export function runKey(ct: string, key: EnigmaKey): TierResult {
  const t = performance.now();
  const four = key.rotors.length === 4;
  const r = scanAndClimb(
    ct,
    { orders: [knownOrder(key)], rings: key.rings.slice(four ? 1 : 0), plugboard: key.plugboard },
    german(),
    { keep: 20 },
  );
  return { tier: 'key', candidates: top(r.candidates), ms: performance.now() - t, examined: r.examined };
}

export interface BombePlan {
  readonly machine: Machine;
  readonly date?: string;
  /** Cribs to try, best first; each is placed at the start of the message. */
  readonly cribs: readonly string[];
  readonly maxCribs?: number;
  /** M4 only: the wheel order and greek wheel from the key list. */
  readonly m4Order?: WheelOrder;
}

export function runBombe(ct: string, plan: BombePlan): TierResult {
  const t = performance.now(),
    lm = german();
  const orders =
    plan.machine === 'M4' ? (plan.m4Order ? [plan.m4Order] : ordersFor('M4')) : ordersFor(plan.machine, plan.date);
  const cribs = plan.cribs.filter(c => cribFits(ct, c, 0)).slice(0, plan.maxCribs ?? 3);
  if (!cribs.length)
    return {
      tier: 'bombe',
      candidates: [],
      ms: performance.now() - t,
      note: 'no crib fits the start of this message',
      cribsTried: [],
    };
  const found: Candidate[] = [];
  let examined = 0;
  const tried: string[] = [];
  const done = () => found.sort((a, b) => b.score - a.score).length > 0 && freeGermanness(best(found)) >= ACCEPT;
  for (const crib of cribs) {
    tried.push(crib);
    const r = bombe(ct, crib, 0, { orders }, lm, { turnovers: 'none' });
    examined += r.examined;
    found.push(...top(r.candidates, 3));
    if (done()) break;
  }
  // No clean break: the middle rotor may have stepped inside the crib. Rerun the first crib with every turnover point
  // (skipped for the 336 naval orders, where it takes minutes per crib).
  if (!done() && orders.length <= 60) {
    tried.push(`${cribs[0]} (all turnovers)`);
    const r = bombe(ct, cribs[0], 0, { orders }, lm, { turnovers: 'all' });
    examined += r.examined;
    found.push(...top(r.candidates, 3));
  }
  found.sort((a, b) => b.score - a.score);
  return { tier: 'bombe', candidates: top(found), ms: performance.now() - t, examined, cribsTried: tried };
}

export function runKnownCrib(
  ct: string,
  plaintext: string,
  machine: Machine,
  date: string | undefined,
  m4Order?: WheelOrder,
): TierResult {
  const t = performance.now(),
    lm = german();
  const crib = plaintext.slice(0, KNOWN_CRIB);
  const orders = machine === 'M4' ? (m4Order ? [m4Order] : ordersFor('M4')) : ordersFor(machine, date);
  const found: Candidate[] = [];
  let examined = 0;
  for (const turnovers of ['none', 'all'] as const) {
    const r = bombe(ct, crib, 0, { orders }, lm, { turnovers });
    examined += r.examined;
    found.push(...top(r.candidates, 3));
    found.sort((a, b) => b.score - a.score);
    if (found.length && freeGermanness(best(found)) >= ACCEPT) break;
  }
  return { tier: 'crib', candidates: top(found), ms: performance.now() - t, examined, cribsTried: [crib] };
}

export function runClimb(ct: string, machine: Machine, date?: string): TierResult {
  const t = performance.now();
  if (machine === 'M4')
    return {
      tier: 'climb',
      candidates: [],
      ms: 0,
      note: 'ciphertext-only M4 (2 greek × 2 reflectors × 336 orders × 26⁴ positions) is out of reach on one machine',
    };
  const r = scanAndClimb(ct, { orders: ordersFor(machine, date) }, german(), {
    keep: machine === 'M3' ? 3000 : 1500,
    climb: 150,
  });
  return { tier: 'climb', candidates: top(r.candidates), ms: performance.now() - t, examined: r.examined };
}
