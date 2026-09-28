/** Step 2 · Tagesschlüssel: set the day's key on the sheet or on the machine itself. */
import { $, A, esc, mod } from '../../shared/dom.js';
import { cilly, consecutive, herivel } from '../../shared/habits.js';
import { click } from '../sound.js';
import { foot, hint, machine, nav, panel, showKey } from '../stage.js';
import { plugPairs, ROTORS, randomKey, S } from '../state.js';
import { resetTape } from '../tape.js';

export function turnRotor(i: number, d: number) {
  if (S.step !== 'key') return;
  S.key = { ...S.key, positions: S.key.positions.map((p, k) => (k === i ? mod(p + d) : p)) };
  machine.setWindows(S.key.positions);
  click('step');
  syncSheet();
}
export function plugSocket(ch: string) {
  if (S.step !== 'key') return;
  let pairs = plugPairs(S.key.plugboard);
  const existing = pairs.find(p => p.includes(ch));
  if (existing) {
    pairs = pairs.filter(p => p !== existing);
    S.pending = null;
  } else if (!S.pending) S.pending = ch;
  else if (S.pending === ch) S.pending = null;
  else if (pairs.length < 13) {
    pairs.push(S.pending + ch);
    S.pending = null;
  }
  S.key = { ...S.key, plugboard: pairs.join(' ') };
  machine.setPlugs(S.key.plugboard, S.pending);
  click('step');
  syncSheet();
}

export function renderKey() {
  machine.setCamera('deck');
  showKey(S.key);
  hint(
    'Turn a rotor by clicking its window or scrolling over it. Click two sockets on the front panel to plug a cable.',
  );
  panel().innerHTML = `
    <p class="ip-k">Step 2 · Tagesschlüssel</p>
    <h2 class="ip-h">Set the day's key</h2>
    <p class="ip-p">Every operator on the network set the same key each morning. Use this sheet or the machine itself: turn the rotors, plug the cables. Whoever holds the key reads the traffic.</p>
    <div class="sheet" id="sheet">
      <div class="sheet-h"><span>${esc(S.service)} · Schlüsseltafel</span><span>Tag ${String(new Date().getDate()).padStart(2, '0')}</span></div>
      <div class="sheet-row"><span data-tr="sheet.order">Walzenlage<small>rotor order</small></span><div class="trio" id="shRotors"></div></div>
      <div class="sheet-row"><span data-tr="m.ring">Ringstellung<small>ring settings</small></span><div class="trio" id="shRings"></div></div>
      <div class="sheet-row"><span data-tr="sheet.grund">Grundstellung<small>start position</small></span><div class="trio" id="shPos"></div></div>
      <div class="sheet-row"><span>Stecker<small id="shCount"></small></span><div class="pairs" id="shPlugs"></div></div>
    </div>
    <p class="habit" id="shHabit" role="status" aria-live="polite"></p>
    <div class="ip-sec row">
      <button class="btn quiet" id="plugView">Plugboard view</button>
      <div class="seg" id="randSeg"><button data-n="10">10 plugs</button><button data-n="6">6</button><button data-n="0">0</button></div>
      <button class="linkbtn" id="rand">New random key</button>
    </div>
    ${foot('<button class="btn primary" id="toType">Key set · type a message</button>')}`;
  const trio = (host: string, render: (i: number) => string) => {
    $(host).innerHTML = [0, 1, 2].map(render).join('');
  };
  trio(
    'shRotors',
    i =>
      `<select class="rotorpick" data-i="${i}" aria-label="rotor ${i + 1}">${ROTORS.map(r => `<option ${S.key.rotors[i] === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`,
  );
  trio(
    'shRings',
    i =>
      `<div class="stepper"><button data-kind="rings" data-i="${i}" data-d="-1" aria-label="ring ${i + 1} down">‹</button><output id="ring${i}"></output><button data-kind="rings" data-i="${i}" data-d="1" aria-label="ring ${i + 1} up">›</button></div>`,
  );
  trio(
    'shPos',
    i =>
      `<div class="stepper"><button data-kind="positions" data-i="${i}" data-d="-1" aria-label="rotor ${i + 1} back">‹</button><output id="pos${i}"></output><button data-kind="positions" data-i="${i}" data-d="1" aria-label="rotor ${i + 1} forward">›</button></div>`,
  );
  for (const s of panel().querySelectorAll<HTMLSelectElement>('.rotorpick'))
    s.onchange = () => {
      const i = Number(s.dataset.i),
        r = [...S.key.rotors];
      const clash = r.indexOf(s.value);
      if (clash >= 0 && clash !== i) r[clash] = r[i];
      r[i] = s.value;
      S.key = { ...S.key, rotors: r };
      machine.setRotorNames(r);
      click('step');
      renderKey();
    };
  for (const b of panel().querySelectorAll<HTMLButtonElement>('.stepper button'))
    b.onclick = () => {
      const kind = b.dataset.kind as 'rings' | 'positions',
        i = Number(b.dataset.i),
        d = Number(b.dataset.d);
      S.key = { ...S.key, [kind]: S.key[kind].map((v, k) => (k === i ? mod(v + d) : v)) };
      if (kind === 'positions') machine.setWindows(S.key.positions);
      click('step');
      syncSheet();
    };
  let plugs = 10;
  const seg = $('randSeg');
  const setSeg = () => {
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button'))
      b.classList.toggle('on', Number(b.dataset.n) === plugs);
  };
  setSeg();
  for (const b of seg.querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => {
      plugs = Number(b.dataset.n);
      setSeg();
    };
  $('rand').onclick = () => {
    S.key = randomKey(plugs, S.service);
    S.pending = null;
    showKey(S.key);
    click('step');
    renderKey();
  };
  let plugCam = false;
  $('plugView').onclick = () => {
    plugCam = !plugCam;
    machine.setCamera(plugCam ? 'plugboard' : 'deck');
    $('plugView').textContent = plugCam ? 'Deck view' : 'Plugboard view';
  };
  $('toType').onclick = () => {
    resetTape();
    nav.go('type');
  };
  syncSheet();
}
function syncSheet() {
  if (S.step !== 'key' || !document.getElementById('sheet')) return;
  S.key.rings.forEach((v, i) => {
    $(`ring${i}`).textContent = `${A[v]} ${String(v + 1).padStart(2, '0')}`;
  });
  S.key.positions.forEach((v, i) => {
    $(`pos${i}`).textContent = A[v];
  });
  // The habits Bletchley lived on: a guessable setting, or windows left beside the rings.
  const lazy =
    cilly(S.key.positions.map(p => A[p]).join('')) ??
    herivel(S.key.positions, S.key.rings) ??
    (S.service === 'Luftwaffe' ? consecutive(S.key.plugboard) : null);
  const hb = $('shHabit');
  hb.innerHTML = lazy
    ? `<span class="habit-k" data-tr="habit.${lazy.kind}">${{ cilly: 'Cilly', herivel: 'Herivel tip', csko: 'Luftwaffe rule' }[lazy.kind]}</span> ${esc(lazy.note)}`
    : '';
  hb.classList.toggle('on', !!lazy);
  const pairs = plugPairs(S.key.plugboard);
  $('shCount').textContent = `${pairs.length} pair${pairs.length === 1 ? '' : 's'}`;
  $('shPlugs').innerHTML =
    pairs
      .map(p => `<span class="pair">${p}<button type="button" data-p="${p}" aria-label="unplug ${p}">×</button></span>`)
      .join('') +
    (S.pending ? `<span class="pair pending">${S.pending}·</span>` : '') +
    (pairs.length || S.pending ? '' : '<span class="stat">no cables</span>');
  for (const b of $('shPlugs').querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => {
      S.key = {
        ...S.key,
        plugboard: plugPairs(S.key.plugboard)
          .filter(p => p !== b.dataset.p)
          .join(' '),
      };
      machine.setPlugs(S.key.plugboard, S.pending);
      syncSheet();
    };
}
