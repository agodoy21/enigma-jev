/**
 * A reference Enigma: Enigma I, M3 and M4, double stepping included.
 *
 * Settings are given left to right, the way an operator reads the windows.
 * For an M4 the first rotor is the greek wheel, which never steps.
 * Rings and positions are 0-based (A = 0).
 */
import { chr, GREEK, idx, mod26, REFLECTORS, ROTORS } from './wiring.js';

export interface EnigmaKey {
  readonly reflector: string;
  /** Left to right. Three rotors, or greek wheel + three for an M4. */
  readonly rotors: readonly string[];
  readonly rings: readonly number[];
  readonly positions: readonly number[];
  /** Pairs, e.g. "AV BS CG". Empty for no plugs. */
  readonly plugboard: string;
}

/** Letters only, upper case. Umlauts and ß are spelled out the way operators did. */
export function clean(text: string): string {
  return text
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE')
    .replace(/ß/g, 'SS')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/g, '');
}

export function groups(text: string, size = 5): string {
  return text.match(new RegExp(`.{1,${size}}`, 'g'))?.join(' ') ?? '';
}

/** "AV BS" → involution table; throws on a letter used twice. */
export function parsePlugboard(pairs: string): Uint8Array {
  const table = new Uint8Array(26).map((_, i) => i);
  for (const pair of pairs
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)) {
    if (pair.length !== 2) throw new Error(`Bad plug pair: ${pair}`);
    const a = idx(pair[0]),
      b = idx(pair[1]);
    if (a === b || table[a] !== a || table[b] !== b) throw new Error(`Letter plugged twice: ${pair}`);
    table[a] = b;
    table[b] = a;
  }
  return table;
}

export function plugboardString(table: ArrayLike<number>): string {
  const out: string[] = [];
  for (let i = 0; i < 26; i++) if (table[i] > i) out.push(chr(i) + chr(table[i]));
  return out.join(' ');
}

/** "BLA" or [1,11,0] or "02 21 12" (1-based numbers) → 0-based array. */
export function parseSetting(v: string | readonly number[], oneBasedNumbers = true): number[] {
  if (Array.isArray(v)) return v.map(n => mod26(n));
  const s = String(v).trim().toUpperCase();
  if (/^[0-9\s,-]+$/.test(s))
    return s
      .split(/[\s,-]+/)
      .filter(Boolean)
      .map(n => mod26(Number(n) - (oneBasedNumbers ? 1 : 0)));
  return clean(s).split('').map(idx);
}

export function settingString(v: readonly number[]): string {
  return v.map(chr).join('');
}

export function describeKey(k: EnigmaKey): string {
  return `UKW ${k.reflector} · ${k.rotors.join('-')} · rings ${settingString(k.rings)} · start ${settingString(k.positions)} · plugs ${k.plugboard || '—'}`;
}

function inverse(w: string): Uint8Array {
  const inv = new Uint8Array(26);
  for (let i = 0; i < 26; i++) inv[idx(w[i])] = i;
  return inv;
}

function validate(k: EnigmaKey): void {
  const four = k.rotors.length === 4;
  if (k.rotors.length !== 3 && !four) throw new Error('An Enigma has three rotors, or four on an M4');
  if (k.rings.length !== k.rotors.length || k.positions.length !== k.rotors.length)
    throw new Error('Rings and positions must match the rotor count');
  if (four && !(k.rotors[0] in GREEK)) throw new Error(`M4 greek wheel must be Beta or Gamma, got ${k.rotors[0]}`);
  if (four && !k.reflector.endsWith('-thin')) throw new Error('An M4 uses a thin reflector (B-thin or C-thin)');
  for (const r of k.rotors.slice(four ? 1 : 0)) if (!(r in ROTORS)) throw new Error(`Unknown rotor ${r}`);
  if (new Set(k.rotors).size !== k.rotors.length) throw new Error('A rotor cannot be used twice');
  if (!(k.reflector in REFLECTORS)) throw new Error(`Unknown reflector ${k.reflector}`);
}

/** One key press: the rotor windows after stepping (left to right), the key and the lamp. */
export interface KeyPress {
  readonly windows: number[];
  readonly key: string;
  readonly lamp: string;
}

/** Encrypts (and so decrypts, the machine being an involution) letters A–Z. Pass `trace` to record each key press. */
export function encrypt(key: EnigmaKey, text: string, trace?: KeyPress[]): string {
  validate(key);
  const four = key.rotors.length === 4;
  const stepping = key.rotors.slice(four ? 1 : 0);
  const wires = stepping.map(r => ROTORS[r].wiring);
  const fwd = wires.map(w => Uint8Array.from(w, c => idx(c)));
  const bwd = wires.map(inverse);
  const notches = stepping.map(r => new Set(ROTORS[r].notches.split('').map(idx)));
  const greekF = four ? Uint8Array.from(GREEK[key.rotors[0]], c => idx(c)) : null;
  const greekB = four ? inverse(GREEK[key.rotors[0]]) : null;
  const refl = Uint8Array.from(REFLECTORS[key.reflector], c => idx(c));
  const plug = parsePlugboard(key.plugboard);
  const off = four ? 1 : 0;
  const rings = key.rings.slice(off),
    pos = key.positions.slice(off) as number[];
  const gShift = four ? mod26(key.positions[0] - key.rings[0]) : 0;

  const through = (table: Uint8Array, c: number, shift: number) => mod26(table[(c + shift) % 26] - shift);
  let out = '';
  for (const ch of clean(text)) {
    // Double stepping: the middle rotor at its notch turns itself and the left rotor.
    if (notches[1].has(pos[1])) {
      pos[1] = (pos[1] + 1) % 26;
      pos[0] = (pos[0] + 1) % 26;
    } else if (notches[2].has(pos[2])) pos[1] = (pos[1] + 1) % 26;
    pos[2] = (pos[2] + 1) % 26;
    const sh = [0, 1, 2].map(i => mod26(pos[i] - rings[i]));
    let c = plug[idx(ch)];
    for (let i = 2; i >= 0; i--) c = through(fwd[i], c, sh[i]);
    if (greekF) c = through(greekF, c, gShift);
    c = refl[c];
    if (greekB) c = through(greekB, c, gShift);
    for (let i = 0; i < 3; i++) c = through(bwd[i], c, sh[i]);
    out += chr(plug[c]);
    trace?.push({ windows: four ? [key.positions[0], ...pos] : [...pos], key: ch, lamp: chr(plug[c]) });
  }
  return out;
}

/** An M4 with Beta at A/A and B-thin is an M3 with UKW B: used to sanity-check the thin parts. */
export const decrypt = encrypt;
