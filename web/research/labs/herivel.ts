/** Figure 5: the two indicator procedures, a cilly checker, and the Herivel tip simulated. */
import { type EnigmaKey, encrypt } from '../../../src/enigma/machine.js';
import { cilly } from '../../shared/habits.js';
import * as D from '../bombe-demo.js';
import { $, A } from './util.js';

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function herivel(host: HTMLElement) {
  const day = D.DEMO_KEY;
  const at = (pos: string): EnigmaKey => ({ ...day, positions: [...pos].map(ch => A.indexOf(ch)) });
  const doubled = encrypt(at('FOL'), 'GEXGEX'),
    once = encrypt(at('VER'), 'ITA');
  const cells = (plain: string, cipher: string, pair: boolean) =>
    `<div class="ind-grid" style="--n:${plain.length}">${[...plain].map((p, i) => `<span class="ip ${pair ? `g${i % 3}` : ''}">${p}</span>`).join('')}${[...cipher].map((c, i) => `<span class="ic ${pair ? `g${i % 3}` : ''}">${c}</span>`).join('')}</div>`;
  host.innerHTML = `<div class="her">
    <div class="her-l">
      <div class="ind"><p class="ind-h">1930–1940 · key sent twice</p>
        <p class="ind-p">Common start from the key sheet: <b class="mono">FOL</b>. The operator picks <b class="mono">GEX</b> and types it twice.</p>
        ${cells('GEXGEX', doubled, true)}
        <p class="ind-p fine">Same letter, two cipher letters, three steps apart: ${doubled[0]}→${doubled[3]}, ${doubled[1]}→${doubled[4]}, ${doubled[2]}→${doubled[5]}. Collect a day's worth and these pairs spell out <i>AD</i>, <i>BE</i>, <i>CF</i> (Figure 4).</p></div>
      <div class="ind"><p class="ind-h">1940–1945 · clear setting, key sent once</p>
        <p class="ind-p">Sent in clear: <b class="mono">VER</b>. At VER the operator types <b class="mono">ITA</b>, then sets ITA and types the message.</p>
        ${cells('ITA', once, false)}
        <p class="ind-p fine">On the air: <b class="mono">VER ${once}</b> … The receiver sets VER, types ${once}, reads ITA, sets ITA.</p></div>
      <label class="cilly-try">Choose a message key <input id="cillyIn" maxlength="3" value="BER" spellcheck="false" autocomplete="off" aria-describedby="cillyOut"></label>
      <p class="lab-read" id="cillyOut" aria-live="polite"></p>
    </div>
    <div class="her-r">
      <div class="lab-controls"><button type="button" class="lab-btn" id="herNew">Another morning</button>
        <label class="lab-range">lazy operators <input type="range" id="herLazy" min="0" max="100" step="5" value="70"><output id="herLazyV">70%</output></label></div>
      <div class="her-hists" id="herHists"></div>
      <p class="lab-read" id="herRead" aria-live="polite"></p>
      <div class="her-chips mono" id="herChips"></div>
    </div></div>`;
  const cOut = $('cillyOut')!,
    cIn = $('cillyIn') as HTMLInputElement;
  const checkCilly = () => {
    const v = cIn.value
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3);
    cIn.value = v;
    if (v.length < 3) {
      cOut.textContent = 'Three letters.';
      return;
    }
    const c = cilly(v);
    cOut.innerHTML = c
      ? `<b class="no">${c.title}.</b> ${c.note}`
      : `<b class="ok">${v} looks random.</b> A cribber has no reason to try it first.`;
  };
  cIn.addEventListener('input', checkCilly);
  checkCilly();

  let seed = 1940;
  const draw = () => {
    const rnd = mulberry(seed),
      lazy = Number(($('herLazy') as HTMLInputElement).value) / 100;
    $('herLazyV')!.textContent = `${Math.round(lazy * 100)}%`;
    const rings = [0, 1, 2].map(() => Math.floor(rnd() * 26));
    const OFF = [-2, -1, -1, 0, 0, 0, 0, 1, 1, 2];
    const settings = Array.from({ length: 60 }, () =>
      rnd() < lazy
        ? rings.map(r => (r + OFF[Math.floor(rnd() * OFF.length)] + 26) % 26)
        : [0, 1, 2].map(() => Math.floor(rnd() * 26)),
    );
    const counts = [0, 1, 2].map(w => {
      const c = new Array(26).fill(0);
      for (const s of settings) c[s[w]]++;
      return c;
    });
    // Herivel's estimate: the centre of the densest five-letter window on each wheel.
    const guess = counts.map(c => {
      let best = 0,
        arg = 0;
      for (let k = 0; k < 26; k++) {
        let s = 0;
        for (let d = -2; d <= 2; d++) s += c[(k + d + 26) % 26] * (3 - Math.abs(d));
        if (s > best) {
          best = s;
          arg = k;
        }
      }
      return arg;
    });
    const max = Math.max(...counts.flat());
    $('herHists')!.innerHTML = counts
      .map(
        (c, w) =>
          `<div class="her-h"><span class="her-w">${['left', 'middle', 'right'][w]} wheel</span><div class="her-bars">${c.map((n, k) => `<i class="${k === guess[w] ? 'peak' : ''}" style="height:${(100 * n) / max}%" title="${A[k]}: ${n} operator${n === 1 ? '' : 's'}"></i>`).join('')}</div><div class="her-ax mono">${[...A].map((ch, k) => `<span class="${k === guess[w] ? 'peak' : ''}">${ch}</span>`).join('')}</div></div>`,
      )
      .join('');
    const ok = guess.every((g, i) => g === rings[i]);
    $('herRead')!.innerHTML =
      `Herivel's guess at the rings: <b class="mono">${guess.map(g => A[g]).join('')}</b>. The day's rings: <b class="mono">${rings.map(r => A[r]).join('')}</b>. ${ok ? '<b class="ok">Right.</b>' : '<b class="no">Not quite</b>; a Bombe would try the neighbours.'}`;
    $('herChips')!.textContent =
      settings
        .slice(0, 18)
        .map(s => s.map(x => A[x]).join(''))
        .join('  ') + '  …';
  };
  $('herNew')!.onclick = () => {
    seed++;
    draw();
  };
  $('herLazy')!.addEventListener('input', draw);
  draw();
}
