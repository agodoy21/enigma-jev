/**
 * The key gate: the machine opens only with a verified TypeSafe key. The key is
 * checked by the server with one Jev question and held there per session; the
 * page keeps it only if the visitor asks to be remembered on this device.
 */
import { $, esc, sleep } from '../shared/dom.js';
import { chime, click } from './sound.js';
import { hint, machine, nav, showKey } from './stage.js';
import { S } from './state.js';
import { renderOpen } from './steps/open.js';
import { resetTape } from './tape.js';

const REMEMBER = 'enigma-jev.key';
export const gate = $('gate'),
  gateKey = $<HTMLInputElement>('gateKey'),
  gateMsg = $('gateMsg'),
  gateGo = $<HTMLButtonElement>('gateGo');
const GATE_NOTE =
  'Checked once with a single Jev question, then sealed in an encrypted cookie only the server can open. Never shown again, never logged.';
export const remembered = {
  get: () => {
    try {
      return localStorage.getItem(REMEMBER);
    } catch {
      return null;
    }
  },
  set: (k: string | null) => {
    try {
      if (k) localStorage.setItem(REMEMBER, k);
      else localStorage.removeItem(REMEMBER);
    } catch {
      /* private window */
    }
  },
};
function gateState(state: '' | 'busy' | 'error' | 'ok', msg?: string) {
  gate.classList.remove('busy', 'error', 'ok');
  if (state) {
    void gate.offsetWidth;
    gate.classList.add(state);
  }
  gateGo.disabled = state === 'busy' || state === 'ok';
  gateKey.readOnly = state === 'busy' || state === 'ok';
  if (msg !== undefined) gateMsg.innerHTML = msg;
}
export function nudgeGate() {
  gateState('error', 'The lid is locked. <b>Enter your TypeSafe key</b> to open it.');
  gateKey.focus();
}

export async function submitKey(auto = false) {
  const key = gateKey.value.trim();
  if (!key) {
    gateState('error', 'Paste or type your <b>TypeSafe key</b> first.');
    gateKey.focus();
    return;
  }
  gateState(
    'busy',
    auto
      ? 'Welcome back. <b>Asking Jev</b> to confirm your saved key…'
      : '<b>Asking Jev</b> one question to verify the key…',
  );
  let r: { ok: boolean; reason?: string; model?: string; hint?: string; latencyMs?: number; german?: number | null };
  try {
    r = await fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }).then(x => x.json());
  } catch {
    r = { ok: false, reason: 'The server did not answer. Is it running?' };
  }
  if (!r.ok) {
    gateState('error', esc(r.reason ?? 'That key did not work.'));
    if (auto) remembered.set(null);
    gateKey.select();
    return;
  }
  remembered.set($<HTMLInputElement>('gateRemember').checked ? key : null);
  gateKey.value = '';
  await unlocked({ model: r.model ?? '', hint: r.hint ?? '', latencyMs: r.latencyMs ?? 0, german: r.german ?? null });
}
/** The choreography: lock gives way → card sinks into the machine → lid opens → the inspector slides in. */
export async function unlocked(
  info: { model: string; hint: string; latencyMs: number; german: number | null },
  quick = false,
) {
  S.unlocked = true;
  S.jev = true;
  S.model = info.model;
  S.keyHint = info.hint;
  S.verifiedMs = info.latencyMs;
  $('lockModel').textContent = `Jev · ${info.model}`;
  const read =
    info.german === null
      ? ''
      : ` · reads the test line as German: <span class="v">${Math.round(info.german * 100)}%</span>`;
  gateState(
    'ok',
    quick
      ? `<b>Session active</b> · ${esc(info.model)} · key ••••${esc(info.hint)}`
      : `<span class="v">✓</span> <b>Verified</b> · ${esc(info.model)} · ${info.latencyMs} ms${read}`,
  );
  chime();
  await sleep(quick ? 350 : 1000);
  gate.classList.add('leaving');
  await sleep(300);
  S.step = 'open';
  S.reached = 0;
  nav.renderSteps();
  renderOpen();
  document.body.classList.add('revealing');
  showKey(S.key);
  machine.setCamera('overview');
  click('lid');
  const opening = machine.openLid();
  await sleep(250);
  document.body.classList.remove('locked');
  machine.refit();
  $('lockBtn').hidden = false;
  await opening;
  gate.classList.remove('leaving');
  gateState('', GATE_NOTE);
  hint("The machine is open. Set the day's key, or start from a real intercept.");
  ($('openBtn') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  setTimeout(() => document.body.classList.remove('revealing'), 1600);
}
/** Close the lid, forget the key, bring the gate back. */
export async function lockMachine(reason?: string) {
  S.typing?.abort();
  S.breaking?.abort();
  S.unlocked = false;
  S.jev = false;
  S.recovered = null;
  S.reached = 0;
  remembered.set(null);
  fetch('/api/lock', { method: 'POST' }).catch(() => {});
  $('lockBtn').hidden = true;
  document.body.classList.add('locked');
  machine.refit();
  machine.setInteractive({ keys: false, rotors: false, sockets: false });
  machine.spin(false);
  await sleep(250);
  click('lid');
  machine.closeLid();
  machine.setCamera('hero');
  S.step = 'open';
  nav.renderSteps();
  renderOpen();
  resetTape();
  gateState(reason ? 'error' : '', reason ?? GATE_NOTE);
  gateKey.value = '';
  // Replay the card's entrance.
  const card = gate.querySelector<HTMLElement>('.gate-card')!;
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
  setTimeout(() => gateKey.focus({ preventScroll: true }), 500);
}
/** Wire the key card and the header's lock button. */
export function initGate() {
  nav.nudgeGate = nudgeGate;
  nav.lockMachine = lockMachine;
  $('gateForm').addEventListener('submit', e => {
    e.preventDefault();
    submitKey();
  });
  gateKey.addEventListener('input', () => {
    if (gate.classList.contains('error')) gateState('', GATE_NOTE);
  });
  // A pasted key is the whole key: unlock straight away.
  gateKey.addEventListener('paste', () =>
    setTimeout(() => {
      if (gateKey.value.trim().length >= 8) submitKey();
    }, 120),
  );
  gateKey.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      gateKey.value = '';
      gateState('', GATE_NOTE);
    }
  });
  $('gateEye').onclick = () => {
    const show = gateKey.type === 'password';
    gateKey.type = show ? 'text' : 'password';
    $('gateEye').setAttribute('aria-pressed', String(show));
    $('gateEye').setAttribute('aria-label', show ? 'Hide key' : 'Show key');
    gateKey.focus();
  };
  $('lockBtn').onclick = () => lockMachine();
}
