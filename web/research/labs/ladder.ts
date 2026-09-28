/** Figure 3: the key space as each German modification was added. */
import { $, fmtInt, plugboards, sci } from './util.js';

export function ladder(host: HTMLElement) {
  const base = 6 * 17576,
    rings = base * 676,
    p6 = rings * plugboards(6),
    five = p6 * 10,
    p10 = 60 * 17576 * 676 * plugboards(10);
  const rows = [
    { name: 'Commercial Enigma', sub: '3 rotors: 6 orders × 26³ positions', v: base, by: '' },
    { name: '+ ring settings', sub: '26² that affect stepping', v: rings, by: '× 676' },
    { name: '+ plugboard, 6 pairs', sub: 'Enigma I, 1930', v: p6, by: `× ${fmtInt(plugboards(6))}` },
    { name: '+ rotors IV and V', sub: '3 of 5 = 60 orders, Dec 1938', v: five, by: '× 10' },
    {
      name: '+ 4 more pairs',
      sub: '10 pairs, from Aug 1939',
      v: p10,
      by: `× ${(plugboards(10) / plugboards(6)).toFixed(1)}`,
    },
    {
      name: 'What a Bombe searched',
      sub: '60 orders × 17,576 positions',
      v: 60 * 17576,
      by: 'plugboard by implication',
      bombe: true,
    },
  ];
  const MAX = 24;
  host.innerHTML =
    `<div class="ld-axis" aria-hidden="true">${[0, 4, 8, 12, 16, 20, 24].map(e => `<span style="left:${(100 * e) / MAX}%">10<sup>${e}</sup></span>`).join('')}</div>` +
    rows
      .map(
        r => `<div class="ld-row${r.bombe ? ' bombe' : ''}" tabindex="0" title="${r.by ? `${r.name}: ${r.by}` : r.name}">
      <div class="ld-name"><b>${r.name}</b><small>${r.sub}</small></div>
      <div class="ld-track"><i style="width:${(100 * Math.log10(r.v)) / MAX}%"></i>${r.by ? `<em>${r.by}</em>` : ''}</div>
      <div class="ld-v">${sci(r.v)}</div></div>`,
      )
      .join('');
  const ratio = $('ladderRatio');
  if (ratio) ratio.textContent = fmtInt(p10 / p6);
}
