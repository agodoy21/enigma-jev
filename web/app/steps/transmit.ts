/** Step 4 · Funkspruch: only the lamps' letters go on the air, in five-letter groups. */
import { $, esc, groups, sleep } from '../../shared/dom.js';
import { click } from '../sound.js';
import { foot, hint, machine, nav, panel } from '../stage.js';
import { S } from '../state.js';

export function renderTransmit() {
  machine.setCamera('overview');
  machine.dark();
  hint('The operator reads the lamps onto a signal form in five-letter groups. The key stays with him.');
  const now = new Date();
  panel().innerHTML = `
    <p class="ip-k">Step 4 · Funkspruch</p>
    <h2 class="ip-h">Transmit</h2>
    <p class="ip-p">Only this form goes on the air: cipher letters in groups of five. Anyone can hear it, and without the key it reads as noise. That is why Bletchley needed a Bombe.</p>
    <div class="funk">
      <div class="funk-h"><span>FUNKSPRUCH</span><span>Nr ${String(now.getMinutes()).padStart(3, '0')}</span></div>
      <div class="funk-meta"><span>Von<b>${esc(S.service)}</b></span><span>Uhrzeit<b>${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}</b></span><span>Buchstaben<b>${S.cipher.length}</b></span></div>
      <div class="funk-body" id="funkBody"><span class="cursor"></span></div>
      <span class="stamp" id="stamp">Gesendet</span>
    </div>
    ${foot('<button class="btn primary" id="send" disabled>Intercepted · send to Bletchley</button>')}`;
  (async () => {
    const body = $('funkBody'),
      text = groups(S.cipher);
    for (let i = 1; i <= text.length; i++) {
      if (S.step !== 'transmit') return;
      body.innerHTML = `${text.slice(0, i)}<span class="cursor"></span>`;
      if (text[i - 1] !== ' ' && i % 2) click('step');
      await sleep(12);
    }
    body.textContent = text;
    $('stamp').classList.add('on');
    ($('send') as HTMLButtonElement).disabled = false;
  })();
  $('send').onclick = () => nav.go('break');
}
