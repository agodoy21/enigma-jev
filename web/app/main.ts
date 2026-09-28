/**
 * Enigma × Jev, the machine page: one machine, six steps.
 *
 *   1 unlock     a TypeSafe key opens the lid
 *   2 key        set the day's key on the sheet or on the machine itself
 *   3 type       type on your keyboard or the machine's; every press steps the rotors
 *   4 transmit   the lamps' letters go onto a radio message form
 *   5 break      Bletchley: crib, Jev, the Bombe; the rotors whirl, then settle on the stop
 *   6 decrypt    the machine is set to the recovered key and types the intercept back
 *
 * The cipher is the same module the server runs (src/enigma/machine.ts).
 */
import { $ } from '../shared/dom.js';
import { gateKey, initGate, nudgeGate, remembered, submitKey, unlocked } from './gate.js';
import { go } from './router.js';
import { initSoundToggle } from './sound.js';
import { handlers, showKey } from './stage.js';
import { S } from './state.js';
import { plugSocket, turnRotor } from './steps/key.js';
import { openMachine, renderOpen } from './steps/open.js';
import { initKeyboard, typeLetter } from './tape.js';

handlers.onOpen = () => {
  if (!S.unlocked) nudgeGate();
  else if (S.step === 'open') openMachine();
};
handlers.onKey = ch => typeLetter(ch, true);
handlers.onRotor = turnRotor;
handlers.onSocket = plugSocket;
initSoundToggle();
initKeyboard();
initGate();

(async () => {
  showKey(S.key);
  go('open');
  const [status, data] = await Promise.all([
    fetch('/api/status')
      .then(r => r.json())
      .catch(() => ({ unlocked: false })),
    fetch('/api/presets').then(r => r.json()),
  ]);
  S.cribs = data.cribs;
  S.presets = data.presets;
  if (S.step === 'open') renderOpen();
  if (status.unlocked) {
    await unlocked({ model: status.model ?? '', hint: status.hint ?? '', latencyMs: 0, german: null }, true);
    return;
  }
  const saved = remembered.get();
  if (saved) {
    gateKey.value = saved;
    $<HTMLInputElement>('gateRemember').checked = true;
    submitKey(true);
    return;
  }
  setTimeout(() => gateKey.focus({ preventScroll: true }), 900);
})();
