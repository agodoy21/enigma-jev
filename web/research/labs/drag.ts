/** Figure 6: crib dragging on the demo intercept and on the D-Day weather intercept. */
import * as D from '../bombe-demo.js';
import { $ } from './util.js';

/** The two intercepts Figure 6 can drag the crib along. */
const INTERCEPTS = {
  demo: {
    label: 'Biscay demo',
    cipher: D.DEMO_CIPHER,
    plain: D.DEMO_PLAIN as string | null,
    at: D.CRIB_AT,
    note: 'enciphered on this simulator',
  },
  dday: {
    label: 'D-Day intercept',
    cipher: 'QFZWRWIVTYRESXBFOGKUHQBAISEZ',
    plain: null,
    at: 4,
    note: 'Biscay weather, 6 June 1944 (Weinbaum 2025)',
  },
};
export function drag(host: HTMLElement) {
  const crib = D.CRIB;
  let which: keyof typeof INTERCEPTS = 'demo',
    truth = false;
  host.innerHTML = `<div class="lab-controls">
      <div class="lab-seg" role="group" aria-label="intercept">${Object.entries(INTERCEPTS)
        .map(([k, v]) => `<button type="button" data-k="${k}" aria-pressed="${k === which}">${v.label}</button>`)
        .join('')}</div>
      <button type="button" class="lab-btn" id="dgPrev" aria-label="shift crib left">◀</button>
      <input type="range" id="dgPos" min="0" value="1" aria-label="crib alignment">
      <button type="button" class="lab-btn" id="dgNext" aria-label="shift crib right">▶</button>
      <button type="button" class="lab-btn" id="dgFit">Next that fits</button>
      <button type="button" class="lab-btn quiet" id="dgTruth">Where was it?</button>
    </div>
    <div class="dg-strip" id="dgStrip"><div class="dg-row mono" id="dgC"></div><div class="dg-row mono crib" id="dgP"></div><div class="dg-row mono plain" id="dgT"></div></div>
    <p class="lab-read" id="dgRead" aria-live="polite"></p>
    <div class="dg-fits" id="dgFits"></div>`;
  const pos = $('dgPos') as HTMLInputElement;
  let C = '',
    max = 0,
    admissible: number[] = [];
  const load = () => {
    const x = INTERCEPTS[which];
    C = x.cipher;
    max = C.length - crib.length;
    admissible = Array.from({ length: max + 1 }, (_, p) => p).filter(p => !D.clashes(C, crib, p).length);
    pos.max = String(max);
    $('dgC')!.innerHTML = [...C].map((ch, i) => `<span data-i="${i}">${ch}</span>`).join('');
    $('dgFits')!.innerHTML =
      `Alignments that survive: ${admissible.map(p => `<button type="button" class="dg-chip mono" data-p="${p}">${p + 1}</button>`).join('')} <span class="fine">${admissible.length} of ${max + 1} · ${x.note}</span>`;
    for (const b of host.querySelectorAll<HTMLElement>('.lab-seg button'))
      b.setAttribute('aria-pressed', String(b.dataset.k === which));
  };
  const render = () => {
    const x = INTERCEPTS[which],
      p = Number(pos.value),
      bad = new Set(D.clashes(C, crib, p));
    $('dgP')!.innerHTML =
      `<span class="pad" style="width:calc(${p} * var(--cw))"></span>` +
      [...crib].map((ch, j) => `<span class="${bad.has(j) ? 'clash' : 'fit'}">${ch}</span>`).join('');
    $('dgT')!.innerHTML =
      truth && x.plain
        ? [...x.plain]
            .map((ch, i) => `<span class="${i >= x.at && i < x.at + crib.length ? 'hit' : ''}">${ch}</span>`)
            .join('')
        : '';
    for (const s of $('dgC')!.children) {
      const i = Number((s as HTMLElement).dataset.i);
      s.classList.toggle('under', i >= p && i < p + crib.length);
      s.classList.toggle('clash', bad.has(i - p));
    }
    const pairs = [...bad].map(j => `${crib[j]} on ${crib[j]}`).join(', ');
    const here = truth && p === x.at,
      where =
        which === 'dday'
          ? ' It is the only survivor, where the crib was placed in 1944.'
          : ' A Bombe run on this alignment finds the key (Figure 7).';
    $('dgRead')!.innerHTML = bad.size
      ? `Alignment ${p + 1}: <b class="no">impossible</b>. ${pairs}: a letter cannot encipher to itself.`
      : `Alignment ${p + 1}: <b class="ok">no letter meets itself</b>. The crib <i>could</i> sit here${here ? `, and it does.${where}` : truth ? ', but it does not. Only a Bombe run could have told.' : '; only a Bombe run can tell.'}`;
    for (const b of host.querySelectorAll<HTMLElement>('.dg-chip')) {
      b.classList.toggle('on', Number(b.dataset.p) === p);
      b.classList.toggle('true', truth && Number(b.dataset.p) === x.at);
    }
    const strip = $('dgStrip')!,
      cell = (strip.querySelector('#dgC span') as HTMLElement | null)?.offsetWidth ?? 14;
    strip.scrollLeft = Math.max(0, p * cell - strip.clientWidth / 2 + (crib.length * cell) / 2);
  };
  const set = (p: number) => {
    pos.value = String(Math.max(0, Math.min(max, p)));
    render();
  };
  pos.addEventListener('input', render);
  $('dgPrev')!.onclick = () => set(Number(pos.value) - 1);
  $('dgNext')!.onclick = () => set(Number(pos.value) + 1);
  $('dgFit')!.onclick = () => set(admissible.find(p => p > Number(pos.value)) ?? admissible[0]);
  $('dgTruth')!.onclick = () => {
    truth = !truth;
    $('dgTruth')!.textContent = truth ? 'Hide the answer' : 'Where was it?';
    if (truth) set(INTERCEPTS[which].at);
    else render();
  };
  $('dgFits')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.dg-chip');
    if (b) set(Number(b.dataset.p));
  });
  host.querySelector('.lab-seg')!.addEventListener('click', e => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.k as
      | keyof typeof INTERCEPTS
      | undefined;
    if (!k || k === which) return;
    which = k;
    truth = false;
    $('dgTruth')!.textContent = 'Where was it?';
    load();
    set(0);
  });
  load();
  set(1);
}
