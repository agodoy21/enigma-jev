import { describe, expect, test } from 'bun:test';
import { accuracy, historicalCases, syntheticCases } from '../src/backtest/cases.js';
import { bombe, cribFits, menuLoops } from '../src/break/bombe.js';
import { scanAndClimb } from '../src/break/climb.js';
import { type EnigmaKey, encrypt } from '../src/enigma/machine.js';
import { openingCribs } from '../src/jev/cribs.js';
import { german, germanness } from '../src/lang/ngrams.js';
import { HEER, toOperatorText } from '../src/lang/normalize.js';
import { knownOrder } from '../src/pipeline/tiers.js';

const lm = german();
const plain = toOperatorText(
  'Munition für leichte Feldhaubitzen dringend benötigt. Bestand nur noch zweihundert Schuss.',
  HEER,
);
const key: EnigmaKey = {
  reflector: 'B',
  rotors: ['II', 'V', 'III'],
  rings: [5, 17, 11],
  positions: [20, 3, 8],
  plugboard: 'AQ BJ CF DW EO HM KZ LX NR SV',
};
const order = knownOrder(key);

describe('language model', () => {
  test('held-out German scores high, random letters near zero', () => {
    expect(germanness(lm, plain)).toBeGreaterThan(0.6);
    expect(germanness(lm, encrypt(key, plain))).toBeLessThan(0.25);
  });
});

describe('bombe', () => {
  test('recovers a full 10-plug key from a 12-letter crib', () => {
    const ct = encrypt(key, plain);
    const r = bombe(ct, 'MUNITIONFUER', 0, { orders: [order] }, lm);
    expect(accuracy(r.candidates[0].plaintext, plain)).toBe(1);
    expect(r.candidates[0].key.plugboard).toBe(key.plugboard);
  });

  test('finds a middle-rotor step inside the crib only with turnovers: all', () => {
    const k = { ...key, positions: [20, 3, 15] }; // right rotor reaches its notch six letters in
    const ct = encrypt(k, plain);
    const none = bombe(ct, 'MUNITIONFUER', 0, { orders: [order] }, lm, { turnovers: 'none' });
    const all = bombe(ct, 'MUNITIONFUER', 0, { orders: [order] }, lm, { turnovers: 'all' });
    expect(none.candidates[0] ? accuracy(none.candidates[0].plaintext, plain) : 0).toBeLessThan(0.5);
    expect(accuracy(all.candidates[0].plaintext, plain)).toBe(1);
  });

  test('1930 manual message: middle ring that avoids a double step, UKW A', () => {
    const c = historicalCases().find(x => x.id === 'heer-1930-manual')!;
    const r = bombe(c.ciphertext, c.plaintext.slice(0, 14), 0, { orders: [knownOrder(c.key)] }, lm, {
      turnovers: 'all',
    });
    expect(accuracy(r.candidates[0].plaintext, c.plaintext)).toBe(1);
  });

  test('crib dragging rules out placements where a letter would encipher to itself', () => {
    expect(cribFits('ABCDE', 'XBZ', 0)).toBe(false);
    expect(cribFits('ABCDE', 'XYZ', 0)).toBe(true);
    expect(menuLoops('BA', 'AB', 0)).toBe(1);
  });
});

describe('scan and climb', () => {
  test('message key from a known daily key', () => {
    const ct = encrypt(key, plain);
    const r = scanAndClimb(ct, { orders: [order], rings: key.rings, plugboard: key.plugboard }, lm);
    expect(r.candidates[0].plaintext).toBe(plain);
  });
});

describe('cases', () => {
  test('every historical case decrypts with its published key', () => {
    for (const c of historicalCases()) expect(encrypt(c.key, c.ciphertext)).toBe(c.plaintext);
  });

  test('synthetic set is reproducible and round-trips', () => {
    const a = syntheticCases(7),
      b = syntheticCases(7);
    expect(a.map(c => c.ciphertext)).toEqual(b.map(c => c.ciphertext));
    for (const c of a) expect(encrypt(c.key, c.ciphertext)).toBe(c.plaintext);
  });

  test('opening cribs respect service and self-encryption', () => {
    const c = historicalCases().find(x => x.id === 'barbarossa-1941-part1')!;
    const heer = openingCribs(c.ciphertext, 'Heer').map(x => x.text);
    expect(heer).toContain('AUFKLX');
    expect(heer).not.toContain('VONVON');
  });
});
