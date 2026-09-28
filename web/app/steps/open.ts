/** Step 1 · Unlock: the machine is open; start from a real intercept or set the day's key. */
import { $, esc } from '../../shared/dom.js';
import type { Truth } from '../bletchley.js';
import { click } from '../sound.js';
import { foot, hint, machine, nav, panel, showKey } from '../stage.js';
import { idx, plugPairs, S } from '../state.js';
import { renderTape } from '../tape.js';

export function renderOpen() {
  if (!S.unlocked) {
    machine.setCamera('hero');
    hint('');
  } else {
    machine.setCamera('overview');
    hint("The machine is open. Set the day's key, or start from a real intercept.");
  }
  panel().innerHTML = `
    <p class="ip-k">Step 1 · Entsperrt</p>
    <h2 class="ip-h">The machine is open.</h2>
    <div class="verified">
      <svg viewBox="0 0 48 58" aria-hidden="true"><path d="M13 27 V17 a11 11 0 0 1 22 0" transform="rotate(28 35 27) translate(0 -7)"/><rect x="6" y="26" width="36" height="28" rx="7"/></svg>
      <div><b>Jev verified</b><span>${esc(S.model || 'jev')} · answered in ${S.verifiedMs} ms · key ••••${esc(S.keyHint)}</span></div>
    </div>
    <p class="ip-p">Set a day's key, type a message and watch it become cipher. Then hand the intercept to Bletchley. A software Bombe searches the machine's settings while Jev, a probabilistic analyst, chooses the crib and judges what the Bombe finds.</p>
    <div class="ip-sec"><p class="ip-label">Or start from a real intercept</p><div class="presetlist" id="presetList"></div></div>
    ${foot('<button class="btn primary" id="openBtn">Set the day\'s key →</button>')}`;
  $('openBtn').onclick = openMachine;
  $('presetList').innerHTML =
    S.presets
      .map(
        p =>
          `<button type="button" data-id="${p.id}">${esc(p.title)}<small>${p.date ?? ''} · ${p.ciphertext.length} letters · ${plugPairs(p.key.plugboard).length} plugs</small></button>`,
      )
      .join('') || '<p class="stat">Loading…</p>';
  for (const b of $('presetList').querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => startFromPreset(b.dataset.id!);
}
export async function openMachine() {
  if (!S.unlocked) {
    nav.nudgeGate();
    return;
  }
  if (machine.isOpen) {
    nav.go('key');
    return;
  }
  showKey(S.key);
  click('lid');
  machine.setCamera('overview');
  await machine.openLid();
  nav.go('key');
}

async function startFromPreset(id: string) {
  const p = S.presets.find(x => x.id === id);
  if (!p) return;
  S.preset = p;
  S.cipher = p.ciphertext;
  S.keyed = '';
  S.lamps = '';
  S.truth = { key: p.key as Truth['key'], plaintext: p.plaintext, chToQ: true, sep: '', from: 'the published key' };
  S.service = p.service;
  S.lang = 'de';
  S.recovered = null;
  if (!machine.isOpen) {
    click('lid');
    machine.setCamera('overview');
    await machine.openLid();
  }
  S.reached = idx('transmit');
  renderTape();
  nav.go('break');
}
