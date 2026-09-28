/** Figure 4: Rejewski's characteristic, unchanged by the plugboard, and the holes of a Zygalski sheet. */
import { compile, scrambler } from '../../../src/break/engine.js';
import { type EnigmaKey, encrypt } from '../../../src/enigma/machine.js';
import * as D from '../bombe-demo.js';
import { $, A } from './util.js';

function cyclesOf(perm: number[]): number[][] {
  const seen = new Array(26).fill(false),
    out: number[][] = [];
  for (let s = 0; s < 26; s++) {
    if (seen[s]) continue;
    const c: number[] = [];
    for (let x = s; !seen[x]; x = perm[x]) {
      seen[x] = true;
      c.push(x);
    }
    out.push(c);
  }
  return out.sort((a, b) => b.length - a.length || a[0] - b[0]);
}
function randomPlugs(n: number): string {
  const l = [...A];
  for (let k = 25; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [l[k], l[j]] = [l[j], l[k]];
  }
  return Array.from({ length: n }, (_, i) => l[2 * i] + l[2 * i + 1]).join(' ');
}
const femaleCache = { key: '', share: 0 };
export function rejewski(host: HTMLElement) {
  let key: EnigmaKey = { ...D.DEMO_KEY, positions: [5, 14, 11] };
  let prev: string | null = null,
    why = "The day's key, with six plug pairs as in 1932.";
  key = { ...key, plugboard: key.plugboard.split(' ').slice(0, 6).join(' ') };
  host.innerHTML = `<div class="lab-controls">
      <button type="button" class="lab-btn" data-a="plugs">New plugboard</button>
      <button type="button" class="lab-btn" data-a="noplugs">No plugboard</button>
      <button type="button" class="lab-btn" data-a="start">New start position</button>
      <button type="button" class="lab-btn" data-a="order">New rotor order</button>
    </div>
    <div class="rj-key mono" id="rjKey"></div><div class="rj-rows" id="rjRows"></div><p class="lab-read" id="rjRead" aria-live="polite"></p>`;
  const render = () => {
    const perm = (k: number) => Array.from({ length: 26 }, (_, x) => A.indexOf(encrypt(key, 'A'.repeat(k) + A[x])[k]));
    const P = [0, 1, 2, 3, 4, 5].map(perm);
    const prods = [
      [0, 3, 'AD'],
      [1, 4, 'BE'],
      [2, 5, 'CF'],
    ] as const;
    const sig: string[] = [];
    $('rjKey')!.innerHTML =
      `rotors <b>${key.rotors.join(' ')}</b> · rings <b>${key.rings.map(r => A[r]).join('')}</b> · common start <b>${key.positions.map(p => A[p]).join('')}</b> · plugs <b>${key.plugboard || 'none'}</b>`;
    $('rjRows')!.innerHTML = prods
      .map(([a, d, name]) => {
        const prod = Array.from({ length: 26 }, (_, x) => P[d][P[a][x]]);
        const cyc = cyclesOf(prod);
        sig.push(cyc.map(c => c.length).join('.'));
        return `<div class="rj-row"><span class="rj-name">${name}</span>
        <div class="rj-bar">${cyc.map(c => `<span style="flex:${c.length}" title="(${c.map(x => A[x]).join('')})">${c.length}</span>`).join('')}</div>
        <div class="rj-cyc mono">${cyc.map(c => `(${c.map(x => A[x]).join('')})`).join('')}</div></div>`;
      })
      .join('');
    // The holes of a Zygalski sheet: start positions where A·D has a fixed point (a 1–4 female is possible).
    const fkey = `${key.rotors.join('')}|${key.rings.join(',')}`;
    if (femaleCache.key !== fkey) {
      const comp = compile({ reflector: 'B', greek: null, rotors: key.rotors as [string, string, string] });
      let yes = 0;
      for (let q = 0; q < 17576; q++) {
        const S = scrambler(comp, 0, key.rings, [(q / 676) | 0, ((q / 26) | 0) % 26, q % 26], 4);
        for (let x = 0; x < 26; x++)
          if (S[S[78 + x]] === x) {
            yes++;
            break;
          }
      }
      femaleCache.key = fkey;
      femaleCache.share = yes / 17576;
    }
    const female = `<span class="rj-female">Zygalski holes for ${key.rotors.join(' ')}: a 1–4 female is possible at <b>${(femaleCache.share * 100).toFixed(1)}%</b> of the 17,576 start positions (Weinbaum's model: 40.5%). The plugboard cannot change it.</span>`;
    const now = sig.join('|');
    const same = prev === null ? null : prev === now;
    $('rjRead')!.innerHTML =
      `${why} ${same === null ? 'Each product splits into cycles that come in equal pairs, the fingerprint Rejewski catalogued.' : same ? '<b class="ok">Cycle lengths unchanged</b>: every letter moved, the structure did not. The plugboard is invisible to it.' : '<b class="eq">Cycle lengths changed</b>: the rotors, unlike the plugboard, leave their fingerprint.'} ${female}`;
    prev = now;
  };
  host.querySelector('.lab-controls')!.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'plugs') {
      key = { ...key, plugboard: randomPlugs(6 + Math.floor(Math.random() * 5)) };
      why = 'New plugboard.';
    }
    if (a === 'noplugs') {
      key = { ...key, plugboard: '' };
      why = 'Plugboard removed.';
    }
    if (a === 'start') {
      key = { ...key, positions: key.positions.map(() => Math.floor(Math.random() * 26)) };
      why = 'New common start position.';
    }
    if (a === 'order') {
      const pool = ['I', 'II', 'III', 'IV', 'V'].sort(() => Math.random() - 0.5);
      key = { ...key, rotors: pool.slice(0, 3) };
      why = 'New rotor order.';
    }
    render();
  });
  render();
}
