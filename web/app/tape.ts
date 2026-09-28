/**
 * Typing: one key press steps the machine and lights a lamp, the paper tape
 * records both, and the console follows whoever is typing.
 */
import { type EnigmaKey, encrypt, type KeyPress } from '../../src/enigma/machine.js';
import { toOperatorText } from '../../src/lang/normalize.js';
import { $, A, groups, sleep } from '../shared/dom.js';
import { quiet } from '../shared/translate.js';
import { click } from './sound.js';
import { hint, machine } from './stage.js';
import { S } from './state.js';

/** One key press: the machine steps, one lamp lights, the tape records both. */
export function typeLetter(ch: string, manual = false) {
  if (!/^[A-Z]$/.test(ch)) return;
  const decrypting = S.step === 'decrypt';
  const key = decrypting ? (S.recovered?.key as EnigmaKey | undefined) : S.key;
  if (!key || (S.step !== 'type' && !decrypting)) return;
  // The first key someone presses starts their own message: the prepared one gives way.
  if (manual && S.step === 'type' && S.source !== 'manual') beginManual();
  const trace: KeyPress[] = [];
  encrypt(key, S.keyed + ch, trace);
  const t = trace.at(-1)!;
  machine.press(ch);
  machine.setWindows(t.windows);
  machine.light(t.lamp, 320);
  click('key');
  const prevKey = S.keyed.at(-1),
    prevLamp = S.lamps.at(-1);
  S.keyed += ch;
  S.lamps += t.lamp;
  renderTape(decrypting ? 'Cipher in' : 'Keys', decrypting ? 'Plain out' : 'Lamps');
  if (manual && S.step === 'type') discover(ch, t.lamp, prevKey, prevLamp);
  if (S.step === 'type') {
    if (S.source === 'manual') followKeys();
    refreshTypeStats();
  }
}

/** The two things everyone notices at a real Enigma, pointed out once, the first time they happen. */
function discover(key: string, lamp: string, prevKey?: string, prevLamp?: string) {
  if (!S.aha.has('twice') && prevKey === key && prevLamp !== lamp) {
    S.aha.add('twice');
    hint(
      `Same key, different lamp: <b>${key}</b> lit <b>${prevLamp}</b>, then <b>${lamp}</b>. The right rotor stepped in between, so the wiring changed. A fixed substitution, Caesar's included, can never do that.`,
      undefined,
      true,
    );
  } else if (!S.aha.has('self') && S.keyed.length >= 12) {
    S.aha.add('self');
    hint(
      `Notice what never happens: the lamp under your finger does not light. No letter enciphers to itself, and that is how Bletchley placed its cribs.`,
      undefined,
      true,
    );
  }
}

/** Someone started typing: clear the tape, put the rotors back to the start, hand the console to the keys. */
function beginManual() {
  if (S.typing) {
    S.typing.abort();
    S.typing = null;
    const b = document.getElementById('autoBtn');
    if (b) b.innerHTML = autoLabel();
  }
  S.keyed = '';
  S.lamps = '';
  machine.setWindows(S.key.positions, false);
  S.source = 'manual';
  const c = document.getElementById('console') as HTMLTextAreaElement | null;
  if (c) {
    c.classList.add('live');
    c.dataset.tr = 'type.live';
  }
  const lbl = document.getElementById('consoleNote');
  if (lbl) {
    lbl.innerHTML = '<span class="livedot"></span>live · following your keys';
    lbl.dataset.tr = 'type.live';
  }
}
/** The console shows exactly what was keyed, in operator letters. */
function followKeys() {
  S.message = S.keyed;
  const c = document.getElementById('console') as HTMLTextAreaElement | null;
  if (c) {
    c.value = S.keyed;
    c.scrollTop = c.scrollHeight;
  }
}
export const autoLabel = () => '<span data-tr="type.auto">▶ Type it on the machine</span>';

export async function autoType(text: string) {
  S.typing?.abort();
  if (S.step === 'type') S.source = 'auto';
  const ctl = new AbortController();
  S.typing = ctl;
  for (const ch of text) {
    if (ctl.signal.aborted) return false;
    typeLetter(ch);
    await sleep(Math.max(18, 240 - 2.3 * S.speed));
  }
  if (S.typing === ctl) S.typing = null;
  return true;
}

export function resetTape() {
  S.keyed = '';
  S.lamps = '';
  renderTape();
}
const TAPE_TR: Record<string, string> = {
  Keys: 'tape.keys',
  Lamps: 'tape.lamps',
  'Cipher in': 'tape.cipherIn',
  'Plain out': 'tape.plainOut',
};
export function renderTape(inLabel = 'Keys', outLabel = 'Lamps') {
  $('tapeInL').textContent = inLabel;
  $('tapeOutL').textContent = outLabel;
  $('tapeInL').dataset.tr = TAPE_TR[inLabel];
  $('tapeOutL').dataset.tr = TAPE_TR[outLabel];
  $('tapeIn').innerHTML = S.keyed ? `<span>${groups(S.keyed)}</span>` : '';
  $('tapeOut').innerHTML = S.lamps ? `<span>${groups(S.lamps)}</span>` : '';
}

/** Typing on the computer's keyboard presses the machine's keys (while typing or decrypting). */
export function initKeyboard() {
  document.addEventListener('keydown', e => {
    const t = e.target;
    if ((t instanceof Element && t.closest('input, textarea, select')) || e.metaKey || e.ctrlKey || e.altKey) return;
    const ch = e.key.toUpperCase();
    if ((S.step === 'type' || (S.step === 'decrypt' && S.recovered)) && /^[A-Z]$/.test(ch)) {
      e.preventDefault();
      quiet();
      typeLetter(ch, true);
    }
  });
}

/** Enigma's unicity distance is ~22 letters: below it many keys give plausible text, so no break can be proven. */
export const SHORT = 25;
export const consoleLetters = () => toOperatorText(S.message, { wordSeparator: S.sep, chToQ: S.chToQ });
export function refreshTypeStats() {
  const stat = document.getElementById('typeStat'),
    btn = document.getElementById('toTransmit') as HTMLButtonElement | null;
  const n = S.keyed.length,
    pending = !n && consoleLetters().length > 0;
  if (stat)
    stat.innerHTML = n
      ? `${n} letter${n === 1 ? '' : 's'} keyed · rotors now at ${lastWindows(S.key, S.keyed)
          .map(p => A[p])
          .join(
            '',
          )}${n < SHORT ? `<span class="shortnote">Short and sweet. It transmits fine, but under ~${SHORT} letters no codebreaker can prove a break: too many keys turn a short cipher into plausible text.</span>` : ''}`
      : pending
        ? 'Nothing keyed yet: Transmit will type the console first.'
        : 'Nothing keyed yet.';
  if (btn) {
    btn.disabled = !n && !pending;
    btn.textContent = pending ? 'Type it & transmit' : 'Transmit the lamps';
  }
}
export function lastWindows(k: EnigmaKey, text: string) {
  const t: KeyPress[] = [];
  encrypt(k, text, t);
  return t.at(-1)?.windows ?? [...k.positions];
}
