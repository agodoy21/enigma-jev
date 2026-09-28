/**
 * Backtest cases: historical messages with published keys and plaintexts
 * (data/historical/messages.json, each checked against this machine), and
 * synthetic messages enciphered here from held-out German text under random
 * keys (data/synthetic/plaintexts.txt).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clean, type EnigmaKey, encrypt, parseSetting } from '../enigma/machine.js';
import { ROTOR_SETS } from '../enigma/wiring.js';
import type { Service } from '../jev/cribs.js';
import { paragraphs, toOperatorText } from '../lang/normalize.js';
import type { Machine } from '../pipeline/tiers.js';

export interface Case {
  readonly id: string;
  readonly title: string;
  readonly kind: 'historical' | 'synthetic';
  readonly machine: Machine;
  readonly service: Service;
  readonly date?: string;
  readonly ciphertext: string;
  readonly plaintext: string;
  readonly key: EnigmaKey;
  readonly plugs: number;
  readonly notes?: string;
}

const DATA = join(import.meta.dir, '..', '..', 'data');

/** Entries left out of scoring, and why. */
export const EXCLUDED: Record<string, string> = {
  'heer-1941-07-07-nr113':
    "no published plaintext (the only decryption on file is unverified), and 26 letters is below any attack's reach",
};

/** One entry of data/historical/messages.json (sources and caveats are documentation only). */
interface RawMessage {
  id: string;
  title: string;
  date: string;
  machine: string;
  reflector: string;
  rotors: string[];
  rings: number[];
  messageKey: string;
  plugboard?: string;
  ciphertext: string;
  plaintext: string;
}

export function historicalCases(): Case[] {
  const raw = JSON.parse(readFileSync(join(DATA, 'historical', 'messages.json'), 'utf8')) as RawMessage[];
  return raw
    .filter(m => !(m.id in EXCLUDED))
    .map(m => {
      const key: EnigmaKey = {
        reflector: m.reflector,
        rotors: m.rotors,
        rings: parseSetting(m.rings.join(' ')),
        positions: parseSetting(m.messageKey),
        plugboard: m.plugboard ?? '',
      };
      const machine = m.machine as Machine;
      return {
        id: m.id,
        title: m.title,
        kind: 'historical' as const,
        machine,
        service: machine === 'I' ? ('Heer' as const) : ('Kriegsmarine' as const),
        date: m.date,
        ciphertext: clean(m.ciphertext),
        plaintext: clean(m.plaintext),
        key,
        plugs: key.plugboard.split(/\s+/).filter(Boolean).length,
        notes: m.id === 'dewiki-example-aachen' ? 'textbook example, not a real intercept (control)' : undefined,
      };
    });
}

/** mulberry32: a small seeded generator, so a synthetic set is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticCases(seed = 1941): Case[] {
  const rand = rng(seed),
    pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const text = readFileSync(join(DATA, 'synthetic', 'plaintexts.txt'), 'utf8');
  return paragraphs(text).map((p, i) => {
    const [label, ...rest] = p.split(':');
    const service = label.trim() as Service,
      prose = rest.join(':').trim();
    const machine: Machine = service === 'Kriegsmarine' ? 'M3' : 'I';
    const style =
      service === 'Heer'
        ? { wordSeparator: '' as const, chToQ: true }
        : service === 'Luftwaffe'
          ? { wordSeparator: 'X' as const, chToQ: false }
          : { wordSeparator: 'J' as const, chToQ: false };
    const plaintext = toOperatorText(prose, style);
    const set = [...ROTOR_SETS[machine]],
      rotors: string[] = [];
    while (rotors.length < 3) {
      const r = pick(set);
      if (!rotors.includes(r)) rotors.push(r);
    }
    // Ten plugs, as from 1939; every fourth message six, as before the war.
    const plugs = i % 4 === 3 ? 6 : 10;
    const letters = [...Array(26).keys()];
    for (let k = 25; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [letters[k], letters[j]] = [letters[j], letters[k]];
    }
    const pairs = Array.from(
      { length: plugs },
      (_, k) => String.fromCharCode(65 + letters[2 * k]) + String.fromCharCode(65 + letters[2 * k + 1]),
    );
    const key: EnigmaKey = {
      reflector: 'B',
      rotors,
      rings: [0, 0, 0].map(() => Math.floor(rand() * 26)),
      positions: [0, 0, 0].map(() => Math.floor(rand() * 26)),
      plugboard: pairs.join(' '),
    };
    return {
      id: `synthetic-${String(i + 1).padStart(2, '0')}`,
      title: prose.slice(0, 48),
      kind: 'synthetic' as const,
      machine,
      service,
      date: i % 2 ? '1942' : '1941',
      ciphertext: encrypt(key, plaintext),
      plaintext,
      key,
      plugs,
    };
  });
}

export function accuracy(guess: string, truth: string): number {
  let same = 0;
  for (let i = 0; i < truth.length; i++) if (guess[i] === truth[i]) same++;
  return same / Math.max(1, truth.length);
}

/** The listed crib that opens the true plaintext, if any (what a perfect crib ranker would pick). */
export function trueCrib(plaintext: string, cribs: readonly string[]): string | null {
  return cribs.filter(c => plaintext.startsWith(c)).sort((a, b) => b.length - a.length)[0] ?? null;
}
