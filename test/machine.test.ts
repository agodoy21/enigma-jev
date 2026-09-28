import { describe, expect, test } from 'bun:test';
import { type EnigmaKey, encrypt, parseSetting } from '../src/enigma/machine.js';

const base: EnigmaKey = {
  reflector: 'B',
  rotors: ['I', 'II', 'III'],
  rings: [0, 0, 0],
  positions: [0, 0, 0],
  plugboard: '',
};

describe('reference machine', () => {
  test('textbook vector: I-II-III, UKW B, AAA/AAA, AAAAA → BDZGO', () => {
    expect(encrypt(base, 'AAAAA')).toBe('BDZGO');
  });

  test('is an involution with plugs and rings', () => {
    const k: EnigmaKey = {
      ...base,
      rotors: ['IV', 'II', 'V'],
      rings: parseSetting('BUL'),
      positions: parseSetting('ADQ'),
      plugboard: 'AV BS CG DL FU HZ IN KM OW RX',
    };
    const plain = 'FEINDLIQEINFANTERIEKOLONNEBEOBAQTET'.repeat(20);
    expect(encrypt(k, encrypt(k, plain))).toBe(plain);
  });

  test('never encrypts a letter to itself', () => {
    const plain = 'A'.repeat(2000);
    expect(encrypt(base, plain)).not.toContain('A');
  });

  test('double step: ADU → ADV → AEW → BFX with I-II-III', () => {
    // The middle rotor (II, notch E) steps twice in a row; observed through output equality with a key started one press later.
    const k = { ...base, positions: parseSetting('ADU') };
    const later = { ...base, positions: parseSetting('BFX') };
    expect(encrypt(k, 'XXXXXX').slice(3)).toBe(encrypt(later, 'XXX'));
  });

  test('M4 with Beta at A/A and B-thin equals M3 with UKW B', () => {
    const k: EnigmaKey = {
      ...base,
      rotors: ['VI', 'I', 'III'],
      rings: parseSetting('CKZ'),
      positions: parseSetting('QWE'),
      plugboard: 'AZ BY',
    };
    const m4: EnigmaKey = {
      ...k,
      reflector: 'B-thin',
      rotors: ['Beta', ...k.rotors],
      rings: [0, ...k.rings],
      positions: [0, ...k.positions],
    };
    const plain = 'WETTERVORHERSAGEBISKAYA'.repeat(10);
    expect(encrypt(m4, plain)).toBe(encrypt(k, plain));
  });
});
