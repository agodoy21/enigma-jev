/** Step 5 · Bletchley Park: the intercept alone, the crib, the Bombe and Jev's verdict. */
import type { EnigmaKey } from '../../../src/enigma/machine.js';
import { $, esc, groups } from '../../shared/dom.js';
import { runBreak, type Service } from '../bletchley.js';
import { click } from '../sound.js';
import { foot, hint, machine, nav, panel } from '../stage.js';
import { LANGS, type Lang, S } from '../state.js';
import { SHORT } from '../tape.js';

export function renderBreak() {
  machine.setCamera('bombe');
  hint('Bletchley has only the intercept. Watch the rotors while the Bombe searches.');
  const src = S.preset ? esc(S.preset.title) : 'your transmission';
  panel().innerHTML = `
    <p class="ip-k">Step 5 · Bletchley Park</p>
    <h2 class="ip-h">Break it</h2>
    <p class="ip-p">The codebreakers hold ${S.cipher.length} letters from ${src}, and nothing else. They guess a crib, the Bombe tests every rotor setting against it, and Jev judges whether what comes out is German.</p>
    <div class="ip-sec">
      <p class="ip-label">Intercept</p>
      <div class="funk" style="margin:0"><div class="funk-body" style="font-size:13px">${groups(S.cipher)}</div></div>
    </div>
    ${S.cipher.length < SHORT ? `<div class="notice"><b>${S.cipher.length} letters is below Enigma's unicity distance (~22).</b> Many keys turn a cipher this short into plausible text, so Bletchley could never have been sure of a break. Try it anyway: the Bombe runs, and Jev decides. For a convincing break, send ${SHORT} letters or more.</div>` : ''}
    <div class="ip-sec">
      <p class="ip-label">Plaintext language <small>Bletchley assumed German</small></p>
      <div class="seg" id="langSeg">${LANGS.map(([l, name, en]) => `<button data-l="${l}" class="${S.lang === l ? 'on' : ''}" data-tr-de="${l === 'de' ? 'Deutsch' : l === 'en' ? 'Englisch' : 'Spanisch'}" data-tr-en="${en}" data-tr-shown="${l === 'en' ? 'en' : 'de'}">${name}</button>`).join('')}</div>
      <p class="stat" id="langNote" style="margin-top:6px"></p>
    </div>
    <div class="ip-sec">
      <p class="ip-label">Your crib <small>optional · TEXT or TEXT@position</small></p>
      <input class="field" id="crib" spellcheck="false" placeholder="e.g. WETTERVORHERSAGE"/>
      ${
        S.preset
          ? '<p class="stat" style="margin-top:6px">Historical openers are rarely on the crib list. <button class="linkbtn" id="hintCrib">Use the known first 14 letters</button></p>'
          : S.truth
            ? '<p class="stat" style="margin-top:6px">Know how it opens? <button class="linkbtn" id="hintCrib">Use your first words as the crib</button>. It runs first, the way a crib-writer\'s best guess did. Without one, the Bombe works through the German crib list in Jev\'s order.</p>'
            : ''
      }
      <div class="row" style="margin-top:10px"><label class="toggle"><input type="checkbox" id="useJev" ${S.jev ? 'checked' : 'disabled'}/> Ask Jev <span class="stat">${S.jev ? esc(S.model) : 'unavailable'}</span></label></div>
    </div>
    <ol class="timeline" id="timeline"></ol>
    ${foot('<button class="btn primary" id="breakBtn">▶ Break it</button><button class="btn quiet" id="stopBtn" hidden>Stop</button>')}`;
  document.getElementById('hintCrib')?.addEventListener('click', () => {
    const known = S.preset
      ? S.preset.hint
      : S.truth!.plaintext.slice(0, Math.min(14, Math.max(6, S.truth!.plaintext.length - 12)));
    ($('crib') as HTMLInputElement).value = known;
  });
  const langNote = () => {
    $('langNote').textContent =
      S.lang === 'de'
        ? 'Candidates are ranked and plugboards completed with German letter statistics; the crib list is German.'
        : `Candidates are scored as ${S.lang === 'en' ? 'English' : 'Spanish'}. The crib list is German, so give the Bombe your message's first words as the crib.`;
  };
  for (const b of $('langSeg').querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => {
      S.lang = b.dataset.l as Lang;
      for (const x of $('langSeg').querySelectorAll('button')) x.classList.toggle('on', x === b);
      langNote();
    };
  langNote();
  $('stopBtn').onclick = () => S.breaking?.abort();
  $('breakBtn').onclick = startBreak;
}
async function startBreak() {
  S.recovered = null;
  const ctl = new AbortController();
  S.breaking = ctl;
  $('breakBtn').hidden = true;
  $('stopBtn').hidden = false;
  machine.setRotorNames(['?', '?', '?']);
  machine.setPlugs('');
  machine.dark();
  const date = S.preset?.date ?? '1941-07-07';
  await runBreak(
    $('timeline'),
    {
      ciphertext: S.cipher,
      service: S.service as Service,
      date,
      crib: ($('crib') as HTMLInputElement).value,
      useJev: ($('useJev') as HTMLInputElement).checked,
      language: S.lang,
    },
    ctl.signal,
    {
      truth: S.truth,
      service: S.service,
      onLocked: () =>
        nav.lockMachine('Your session ended (the server restarted). Enter the key again to reopen the machine.'),
      onEvent: ev => {
        if (S.step !== 'break') return;
        if (ev.type === 'bombe-start' || ev.type === 'climb-start') {
          machine.setCamera('bombe');
          machine.spin(true);
        }
        if (ev.type === 'bombe-done' || ev.type === 'climb-done') {
          machine.spin(false);
          if (ev.accepted && ev.best) {
            const k = ev.best.key as EnigmaKey;
            machine.setRotorNames(k.rotors);
            machine.setWindows(k.positions);
            machine.setPlugs(k.plugboard);
            machine.setFlap(true);
            click('lid');
          }
        }
        if (ev.type === 'result' && ev.chosen >= 0 && ev.candidate) S.recovered = ev.candidate;
      },
    },
  );
  machine.spin(false);
  S.breaking = null;
  if (S.step !== 'break') return;
  $('stopBtn').hidden = true;
  const f = panel().querySelector('.ip-foot')!;
  f.innerHTML = S.recovered
    ? '<button class="btn primary" id="toDecrypt">Decrypt on the machine</button>'
    : '<button class="btn quiet" id="again">Try again with a crib</button>';
  document.getElementById('toDecrypt')?.addEventListener('click', () => nav.go('decrypt'));
  document.getElementById('again')?.addEventListener('click', () => renderBreak());
}
