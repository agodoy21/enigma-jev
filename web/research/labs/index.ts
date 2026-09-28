/**
 * The research page's live figures (3–7). Each is computed in the browser on
 * the project's own simulator, so the numbers in the text can be checked by
 * playing with them.
 */
import { bombeLab } from './bombe.js';
import { drag } from './drag.js';
import { herivel } from './herivel.js';
import { ladder } from './ladder.js';
import { rejewski } from './rejewski.js';
import { $ } from './util.js';

export function initLabs() {
  const run = (id: string, f: (host: HTMLElement) => void) => {
    const host = $(id);
    if (host)
      try {
        f(host);
      } catch (err) {
        host.innerHTML = `<p class="fine">This figure could not be computed: ${String(err)}</p>`;
      }
  };
  run('ladder', ladder);
  run('rejLab', rejewski);
  run('herLab', herivel);
  run('dragLab', drag);
  run('bombeLab', bombeLab);
}
