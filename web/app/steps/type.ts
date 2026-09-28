/** Step 3 · Tippen: write a message in the console, or type it on the keys. */
import { toOperatorText } from '../../../src/lang/normalize.js';
import { $, esc, sleep } from '../../shared/dom.js';
import { setTranslations, translationsOn } from '../../shared/translate.js';
import type { Truth } from '../bletchley.js';
import { foot, hint, machine, nav, panel, showKey } from '../stage.js';
import { DEFAULT_MESSAGE, detectLang, S } from '../state.js';
import { autoLabel, autoType, consoleLetters, lastWindows, refreshTypeStats, renderTape, resetTape } from '../tape.js';

export function renderType() {
  machine.setCamera('deck');
  showKey(S.key, S.keyed ? lastWindows(S.key, S.keyed) : S.key.positions);
  renderTape();
  hint(
    "Type on your keyboard <kbd>A</kbd>–<kbd>Z</kbd> or press the machine's keys. Every press steps the rotors and lights one lamp.",
    'type.hint',
  );
  const live = S.source === 'manual';
  panel().innerHTML = `
    <div class="ip-top"><p class="ip-k" data-tr="type.kicker">Step 3 · Tippen</p>
      <button class="trpill" id="trPill" role="switch" aria-checked="${translationsOn()}" title="German ⇄ American English on hover"><span class="trflag">DE</span><span class="trarrows">⇄</span><span class="trflag">US</span></button></div>
    <h2 class="ip-h" data-tr="type.title">Type your message</h2>
    <p class="ip-p" data-tr="type.body">Each press sends current through the plugboard, three rotors and the reflector, and back to a lamp. The right rotor steps before every letter, so the same key rarely lights the same lamp twice, and no letter ever lights itself.</p>
    <div class="ip-sec">
      <p class="ip-label"><span data-tr="type.console">Console</span> <small id="consoleNote" data-tr="${live ? 'type.live' : 'type.consoleHint'}">${live ? '<span class="livedot"></span>live · following your keys' : 'write it here, or just start typing on the keys'}</small></p>
      <textarea class="console ${live ? 'live' : ''}" id="console" spellcheck="false" ${live ? 'data-tr="type.live"' : S.message === DEFAULT_MESSAGE ? 'data-tr="msg.default"' : ''}>${esc(S.message)}</textarea>
      <div class="row" style="margin-top:10px">
        <div class="seg" id="svcSeg">${['Heer', 'Luftwaffe', 'Kriegsmarine'].map(s => `<button data-s="${s}" data-tr="svc.${s}" class="${S.service === s ? 'on' : ''}">${s}</button>`).join('')}</div>
        <label class="toggle" data-tr="type.chq"><input type="checkbox" id="chq" ${S.chToQ ? 'checked' : ''}/> CH → Q</label>
      </div>
    </div>
    <div class="ip-sec"><p class="ip-label"><span data-tr="type.openers">Routine openers</span> <small data-tr="type.openersHint">what Bletchley guessed messages began with</small></p><div class="chips" id="openers"></div></div>
    <div class="ip-sec row">
      <button class="btn quiet" id="autoBtn">${autoLabel()}</button>
      <label class="speed" data-tr="type.speed">speed <input type="range" id="speedR" min="0" max="100" value="${S.speed}"/></label>
      <button class="linkbtn" id="clearBtn" data-tr="type.clear">Clear &amp; reset rotors</button>
    </div>
    <p class="stat" id="typeStat"></p>
    ${foot('<button class="btn primary" id="toTransmit" data-tr="type.transmit" disabled>Transmit the lamps</button>')}`;
  $('trPill').onclick = () => {
    const on = !translationsOn();
    setTranslations(on);
    $('trPill').setAttribute('aria-checked', String(on));
  };
  const con = $('console') as HTMLTextAreaElement;
  con.oninput = () => {
    S.message = con.value;
    // Writing in the console hands it back from the keys.
    if (S.source === 'manual') {
      S.source = null;
      con.classList.remove('live');
      $('consoleNote').textContent = 'write it here, or just start typing on the keys';
      $('consoleNote').dataset.tr = 'type.consoleHint';
    }
    if (con.value === DEFAULT_MESSAGE) con.dataset.tr = 'msg.default';
    else delete con.dataset.tr;
    refreshTypeStats();
  };
  for (const b of $('svcSeg').querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => {
      S.service = b.dataset.s!;
      S.chToQ = S.service === 'Heer';
      S.sep = S.service === 'Kriegsmarine' ? 'J' : '';
      renderType();
    };
  ($('chq') as HTMLInputElement).onchange = e => {
    S.chToQ = (e.target as HTMLInputElement).checked;
  };
  $('openers').innerHTML = S.cribs
    .filter(c => c.services.includes(S.service))
    .slice(0, 10)
    .map(c => `<button class="chip" data-tr="crib.${c.text}">${c.text}</button>`)
    .join('');
  for (const b of $('openers').querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => {
      if (S.source === 'manual') {
        S.source = null;
        con.classList.remove('live');
        con.value = '';
      }
      con.value = `${b.textContent!.toLowerCase()} ${con.value}`.trim();
      S.message = con.value;
      delete con.dataset.tr;
    };
  ($('speedR') as HTMLInputElement).oninput = e => {
    S.speed = Number((e.target as HTMLInputElement).value);
  };
  $('clearBtn').onclick = () => {
    S.typing?.abort();
    S.source = null;
    resetTape();
    machine.setWindows(S.key.positions);
    refreshTypeStats();
    con.classList.remove('live');
  };
  $('autoBtn').onclick = async () => {
    if (S.typing) {
      S.typing.abort();
      S.typing = null;
      $('autoBtn').innerHTML = autoLabel();
      return;
    }
    const text = toOperatorText(S.message, { wordSeparator: S.sep, chToQ: S.chToQ });
    con.classList.remove('live');
    resetTape();
    machine.setWindows(S.key.positions, false);
    $('autoBtn').innerHTML = '<span data-tr="type.stop">■ Stop</span>';
    await autoType(text);
    const b = document.getElementById('autoBtn');
    if (b) b.innerHTML = autoLabel();
  };
  $('toTransmit').onclick = async () => {
    if (!S.keyed) {
      const btn = $('toTransmit') as HTMLButtonElement;
      btn.disabled = true;
      machine.setWindows(S.key.positions, false);
      const done = await autoType(consoleLetters());
      if (!done || S.step !== 'type' || !S.keyed) return;
      await sleep(350);
    }
    S.typing?.abort();
    S.cipher = S.lamps;
    S.preset = null;
    S.recovered = null;
    S.truth = { key: S.key as Truth['key'], plaintext: S.keyed, chToQ: S.chToQ, sep: S.sep, from: 'your transmission' };
    S.lang = S.source === 'manual' ? 'de' : detectLang(S.message);
    nav.go('transmit');
  };
  refreshTypeStats();
}
