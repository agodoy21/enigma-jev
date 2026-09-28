/** The six steps: the step bar in the header, and moving between steps. */
import { $ } from '../shared/dom.js';
import { machine, nav } from './stage.js';
import { idx, S, STEPS, type Step } from './state.js';
import { renderBreak } from './steps/break.js';
import { renderDecrypt } from './steps/decrypt.js';
import { renderKey } from './steps/key.js';
import { renderOpen } from './steps/open.js';
import { renderTransmit } from './steps/transmit.js';
import { renderType } from './steps/type.js';

export function renderSteps() {
  $('steps').innerHTML = STEPS.map(([s, label], i) => {
    const cls = s === S.step ? 'now' : i <= S.reached ? 'done' : '';
    return `<li class="${cls}"><button type="button" data-step="${s}" data-tr="step.${s}" ${cls === 'done' ? '' : 'tabindex="-1"'} ${s === S.step ? 'aria-current="step"' : ''}><span class="n">${i + 1}</span><span class="t">${label}</span></button></li>`;
  }).join('');
  for (const b of $('steps').querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => {
      const s = b.dataset.step as Step;
      if (idx(s) <= S.reached && s !== S.step) go(s);
    };
}

export function go(step: Step) {
  S.typing?.abort();
  S.step = step;
  S.reached = Math.max(S.reached, idx(step));
  S.pending = null;
  machine.spin(false);
  machine.setInteractive({ keys: step === 'type', rotors: step === 'key', sockets: step === 'key' });
  renderSteps();
  (
    ({
      open: renderOpen,
      key: renderKey,
      type: renderType,
      transmit: renderTransmit,
      break: renderBreak,
      decrypt: renderDecrypt,
    }) as Record<Step, () => void>
  )[step]();
  $('panel').scrollTop = 0;
}

nav.go = go;
nav.renderSteps = renderSteps;
