/** Step 6 · Entzifferung: set the recovered key and type the intercept back into plaintext. */
import type { EnigmaKey } from '../../../src/enigma/machine.js';
import { $, A, esc, groups, sleep } from '../../shared/dom.js';
import { click } from '../sound.js';
import { foot, hint, machine, nav, panel, showKey } from '../stage.js';
import { idx, plugPairs, S } from '../state.js';
import { autoType, renderTape, resetTape } from '../tape.js';

export function renderDecrypt() {
  const r = S.recovered;
  if (!r) {
    nav.go('break');
    return;
  }
  machine.setCamera('deck');
  const k = r.key as EnigmaKey;
  showKey(k);
  S.keyed = '';
  S.lamps = '';
  renderTape('Cipher in', 'Plain out');
  hint(
    'Same machine, recovered key. Type the cipher and the lamps spell the plaintext: the Enigma deciphers what it enciphers.',
  );
  const t = S.truth;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const pairs = (s: string) =>
    plugPairs(s)
      .map(p => [...p].sort().join(''))
      .sort()
      .join(' ');
  const row = (label: string, got: string, want: string | null, ok: boolean) =>
    `<tr><th>${label}</th><td class="m">${got}</td>${t ? `<td class="m">${want}</td><td>${ok ? '<span class="ok">✓</span>' : '<span class="eq">≡</span>'}</td>` : ''}</tr>`;
  panel().innerHTML = `
    <p class="ip-k">Step 6 · Entzifferung</p>
    <h2 class="ip-h">Decrypt on the machine</h2>
    <p class="ip-p">Bletchley recovered the day's key. Set it on the same machine and type the intercept. Because the Enigma is its own inverse, the lamps now spell the original message.</p>
    <table class="cmp">
      <tr><th></th><th>recovered</th>${t ? `<th>${esc(t.from)}</th><th></th>` : ''}</tr>
      ${row('Walzenlage', k.rotors.join(' '), t ? t.key.rotors.join(' ') : null, !!t && same(k.rotors, t.key.rotors))}
      ${row('Ringstellung', k.rings.map(x => A[x]).join(''), t ? t.key.rings.map(x => A[x]).join('') : null, !!t && same(k.rings, t.key.rings))}
      ${row('Grundstellung', k.positions.map(x => A[x]).join(''), t ? t.key.positions.map(x => A[x]).join('') : null, !!t && same(k.positions, t.key.positions))}
      ${row('Stecker', k.plugboard || '—', t ? t.key.plugboard : null, !!t && pairs(k.plugboard) === pairs(t.key.plugboard))}
    </table>
    ${t ? '<p class="stat" style="margin-bottom:14px">≡ equivalent: a different ring and start letter with the same rotor offsets. It deciphers identically.</p>' : ''}
    <div id="decOut"></div>
    ${foot('<button class="btn primary" id="decBtn">▶ Set the machine &amp; decrypt</button><button class="btn quiet" id="newBtn">New message</button>')}`;
  $('newBtn').onclick = () => {
    S.recovered = null;
    S.preset = null;
    resetTape();
    S.reached = idx('key');
    nav.go('key');
  };
  $('decBtn').onclick = async () => {
    const btn = $('decBtn') as HTMLButtonElement;
    btn.disabled = true;
    showKey(k);
    S.keyed = '';
    S.lamps = '';
    renderTape('Cipher in', 'Plain out');
    click('lid');
    await sleep(450);
    const done = await autoType(S.cipher);
    if (!done || S.step !== 'decrypt') return;
    const acc = t
      ? [...t.plaintext].filter((ch, i) => S.lamps[i] === ch).length / Math.max(1, t.plaintext.length)
      : null;
    let reading = S.lamps.replace(/XX/g, ': ').replace(/X/g, ' ').replace(/J/g, ' ');
    if (S.service === 'Heer' || t?.chToQ) reading = reading.replace(/Q/g, 'CH');
    $('decOut').innerHTML =
      `<div class="result"><p class="ip-label">The message${acc !== null ? ` <small>${Math.round(acc * 100)}% of letters match ${esc(t!.from)}</small>` : ''}</p><div class="plain">${groups(S.lamps)}</div><div class="read">“${esc(reading.toLowerCase())}”</div></div>`;
    btn.disabled = false;
    btn.textContent = '↻ Decrypt again';
  };
}
