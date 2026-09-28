/**
 * The machine page's state: one object, mutated by the steps, plus the
 * vocabulary they share (steps, rotors, languages, the default message).
 */
import type { EnigmaKey } from '../../src/enigma/machine.js';
import { A } from '../shared/dom.js';
import type { CandidateView, Truth } from './bletchley.js';

export type Step = 'open' | 'key' | 'type' | 'transmit' | 'break' | 'decrypt';
export type Crib = { text: string; meaning: string; services: string[] };
export type Preset = {
  id: string;
  title: string;
  date: string | null;
  service: string;
  ciphertext: string;
  notes: string | null;
  key: EnigmaKey;
  plaintext: string;
  hint: string;
};
export type Lang = 'de' | 'en' | 'es';

export const STEPS: Array<[Step, string]> = [
  ['open', 'Unlock'],
  ['key', 'Daily key'],
  ['type', 'Type'],
  ['transmit', 'Transmit'],
  ['break', 'Break'],
  ['decrypt', 'Decrypt'],
];
export const ROTORS = ['I', 'II', 'III', 'IV', 'V'];
export const DEFAULT_MESSAGE =
  'Wettervorhersage für morgen. Nebel über dem Flugplatz, Sicht unter fünfhundert Meter. Aufklärer bleiben am Boden bis Mittag.';

/** Position of a step in the flow. */
export const idx = (s: Step) => STEPS.findIndex(x => x[0] === s);

export const S = {
  step: 'open' as Step,
  reached: 0,
  key: randomKey(10),
  service: 'Luftwaffe',
  chToQ: false,
  sep: '' as '' | 'X' | 'J',
  message: DEFAULT_MESSAGE,
  /** Who filled the tape: the console's auto-typing, or someone at the keys. */
  source: null as null | 'auto' | 'manual',
  keyed: '',
  lamps: '',
  cipher: '',
  pending: null as string | null,
  truth: null as Truth | null,
  preset: null as Preset | null,
  recovered: null as CandidateView | null,
  typing: null as AbortController | null,
  breaking: null as AbortController | null,
  speed: 70,
  cribs: [] as Crib[],
  presets: [] as Preset[],
  jev: false,
  model: '',
  /** The plaintext language the codebreaker assumes. Bletchley assumed German; a live demo may not be. */
  lang: 'de' as Lang,
  /** One-off discoveries already shown while typing (same key twice, no letter lights itself). */
  aha: new Set<string>(),
  /** The machine opens only with a verified TypeSafe key (held server-side for the session). */
  unlocked: false,
  keyHint: '',
  verifiedMs: 0,
};

export function randomKey(plugs: number, service = 'Luftwaffe'): EnigmaKey {
  const pool = [...ROTORS],
    rotors: string[] = [];
  while (rotors.length < 3) rotors.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const letters = [...A];
  // Luftwaffe sheets never plugged alphabet neighbours (A–B); reshuffle until none are.
  const neighbours = () =>
    Array.from(
      { length: plugs },
      (_, i) => Math.abs(letters[2 * i].charCodeAt(0) - letters[2 * i + 1].charCodeAt(0)) === 1,
    ).some(Boolean);
  do {
    for (let k = 25; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [letters[k], letters[j]] = [letters[j], letters[k]];
    }
  } while (service === 'Luftwaffe' && neighbours());
  const r = () => Math.floor(Math.random() * 26);
  return {
    reflector: 'B',
    rotors,
    rings: [r(), r(), r()],
    positions: [r(), r(), r()],
    plugboard: Array.from({ length: plugs }, (_, i) => letters[2 * i] + letters[2 * i + 1]).join(' '),
  };
}
export const plugPairs = (p: string) => p.split(/\s+/).filter(x => x.length === 2);

export const LANGS: Array<[Lang, string, string]> = [
  ['de', 'Deutsch', 'German'],
  ['en', 'English', 'English'],
  ['es', 'Español', 'Spanish'],
];
/** A first guess at the plaintext's language from common function words; the codebreaker can change it. */
export function detectLang(prose: string): Lang {
  const words = prose
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-zäöüß]+/)
    .filter(Boolean);
  const sets: Record<Lang, string[]> = {
    de: [
      'der',
      'die',
      'das',
      'und',
      'ist',
      'nicht',
      'mit',
      'fur',
      'den',
      'dem',
      'ein',
      'eine',
      'uber',
      'bis',
      'wir',
      'sie',
      'ich',
      'morgen',
      'hallo',
    ],
    en: [
      'the',
      'and',
      'of',
      'to',
      'is',
      'you',
      'in',
      'for',
      'with',
      'on',
      'we',
      'at',
      'hello',
      'are',
      'how',
      'meet',
      'tomorrow',
      'this',
      'it',
    ],
    es: [
      'el',
      'la',
      'de',
      'que',
      'y',
      'los',
      'las',
      'en',
      'por',
      'con',
      'como',
      'hola',
      'para',
      'una',
      'un',
      'nos',
      'estas',
      'manana',
      'es',
    ],
  };
  const score = (l: Lang) => words.filter(w => sets[l].includes(w)).length;
  const best = (Object.keys(sets) as Lang[]).sort((a, b) => score(b) - score(a))[0];
  return score(best) > 0 ? best : 'de';
}
