import { describe, expect, test } from 'bun:test';
import {
  busiest,
  clashes,
  DemoBombe,
  type Edge,
  liveCount,
  menuOf,
  onLoop,
  posIndex,
  posLetters,
  shortestLoop,
} from '../src/break/register.js';
import { type EnigmaKey, encrypt } from '../src/enigma/machine.js';

const KEY: EnigmaKey = {
  reflector: 'B',
  rotors: ['II', 'V', 'III'],
  rings: [1, 20, 5],
  positions: [0, 0, 0],
  plugboard: '',
};
const loopOf = (letters: string, at: number[]): Edge[] =>
  [...letters].map((ch, k) => ({
    a: ch.charCodeAt(0) - 65,
    b: letters.charCodeAt((k + 1) % letters.length) - 65,
    i: at[k],
  }));
const stops = (edges: Edge[], positions: number, diagonal = false) => {
  const b = new DemoBombe(KEY, edges);
  let n = 0;
  for (let p = 0; p < positions; p++) if (liveCount(b.test(p * 7, edges[0].a, 0, diagonal)) < 26) n++;
  return n;
};

describe('test register (Weinbaum 2025, ch. 4)', () => {
  test('an even-length loop stops at every position: an even permutation is never a 26-cycle', () => {
    expect(stops(loopOf('RZ', [3, 11]), 400)).toBe(400);
    expect(stops(loopOf('AKQT', [2, 5, 9, 14]), 400)).toBe(400);
  });
  test('an odd-length loop rejects some positions, and about 1 in 13 of them', () => {
    const s = stops(loopOf('RYS', [6, 22, 9]), 1500);
    expect(s).toBeLessThan(1500);
    expect(1 - s / 1500).toBeGreaterThan(0.04);
    expect(1 - s / 1500).toBeLessThan(0.12);
  });
  test('the true setting survives, with the key sheet’s plug in the dark wire', () => {
    const key: EnigmaKey = { ...KEY, positions: [16, 4, 18], plugboard: 'AM BT CQ DH EJ FO GR IW KP LY' };
    const plain = 'UMSECHSUHRXWETTERVORHERSAGEBISKAYAXXWIND';
    const edges = menuOf(encrypt(key, plain), 'WETTERVORHERSAGEBISKAYA', 11);
    const reg = new DemoBombe(key, edges).test(16 * 676 + 4 * 26 + 18, 4, 0, true); // test letter E, guess E–A
    expect(liveCount(reg)).toBe(25);
    expect([...reg].indexOf(0)).toBe(9); // J: the sheet plugs E–J
  });
  test('D-Day Biscay weather: only one alignment of the crib survives', () => {
    const ct = 'QFZWRWIVTYRESXBFOGKUHQBAISEZ',
      crib = 'WETTERVORHERSAGEBISKAYA';
    const fits = Array.from({ length: ct.length - crib.length + 1 }, (_, at) => at).filter(
      at => !clashes(ct, crib, at).length,
    );
    expect(fits).toEqual([4]);
  });
  test('menu structure: loops, the test letter and position names', () => {
    const edges = loopOf('RYS', [6, 22, 9]).concat([{ a: 17, b: 0, i: 30 }]); // R–A hangs off the loop
    const loop = shortestLoop(edges)!;
    expect(loop.edges).toHaveLength(3);
    expect(onLoop(edges, 3)).toBe(false);
    expect([17, 24, 18]).toContain(busiest(edges));
    expect(posLetters(posIndex([16, 4, 18]))).toBe('QES');
    expect(shortestLoop(loopOf('AB', [1, 2]).slice(0, 1))).toBeNull();
  });
});
