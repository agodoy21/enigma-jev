import { describe, expect, test } from 'bun:test';
import { type EnigmaKey, encrypt } from '../src/enigma/machine.js';
import { toOperatorText } from '../src/lang/normalize.js';
import {
  ACCEPT,
  freeGermanness,
  knownOrder,
  ordersFor,
  reflectorsFor,
  runKey,
  runVerify,
} from '../src/pipeline/tiers.js';

const KEY: EnigmaKey = {
  reflector: 'B',
  rotors: ['II', 'IV', 'V'],
  rings: [1, 20, 11],
  positions: [1, 11, 0],
  plugboard: 'AV BS CG DL FU HZ IN KM OW RX',
};
const PLAIN = toOperatorText(
  'Aufklärung meldet starke feindliche Kräfte im Raum westlich der Brücke. Angriff beginnt morgen früh um fünf Uhr.',
);

describe('tiers', () => {
  test('wheel orders by machine and date', () => {
    expect(ordersFor('I')).toHaveLength(60);
    expect(ordersFor('M3')).toHaveLength(336);
    expect(ordersFor('M4')).toHaveLength(2 * 336 * 2);
    expect(reflectorsFor('I', '1930-01-01')).toEqual(['A']);
    expect(reflectorsFor('I', '1941-07-07')).toEqual(['B']);
    expect(knownOrder({ ...KEY, reflector: 'B-thin', rotors: ['Beta', 'II', 'IV', 'I'] })).toEqual({
      reflector: 'B-thin',
      greek: 'Beta',
      rotors: ['II', 'IV', 'I'],
    });
  });

  test('verify: the full key reproduces the plaintext', () => {
    const ct = encrypt(KEY, PLAIN);
    expect(runVerify(ct, KEY).candidates[0].plaintext).toBe(PLAIN);
  });

  test('key: with the daily key, one scan finds the message key', () => {
    const ct = encrypt(KEY, PLAIN);
    const r = runKey(ct, { ...KEY, positions: [0, 0, 0] });
    expect(r.candidates[0].plaintext).toBe(PLAIN);
    expect(freeGermanness(r.candidates[0])).toBeGreaterThan(ACCEPT);
  });
});
