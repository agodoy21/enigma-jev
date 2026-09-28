/**
 * The stage: the 3D machine, the hint line and the inspector panel, plus `nav`,
 * the late-bound registry through which modules reach each other without
 * import cycles (the router, the gate and the typing module fill it in).
 */
import type { EnigmaKey } from '../../src/enigma/machine.js';
import { Machine3D } from '../machine/machine3d.js';
import { $ } from '../shared/dom.js';
import type { Step } from './state.js';
import { S } from './state.js';

/** What the machine's own controls do; main.ts wires them. */
export const handlers = {
  onOpen: () => {},
  onKey: (_ch: string) => {},
  onRotor: (_i: number, _d: number) => {},
  onSocket: (_ch: string) => {},
};

export const nav = {
  go: (_step: Step) => {},
  renderSteps: () => {},
  nudgeGate: () => {},
  lockMachine: (_reason?: string): Promise<void> => Promise.resolve(),
};

export const machine = new Machine3D($('machineHost'), {
  onOpen: () => handlers.onOpen(),
  onKey: ch => handlers.onKey(ch),
  onRotor: (i, d) => handlers.onRotor(i, d),
  onSocket: ch => handlers.onSocket(ch),
});

/** Show a key on the machine: rotor names, windows, cables. */
export function showKey(k: EnigmaKey, windows: readonly number[] = k.positions) {
  machine.setRotorNames(k.rotors);
  machine.setWindows(windows, false);
  machine.setPlugs(k.plugboard, S.pending);
}

export function hint(html: string, tr?: string, aha = false) {
  $('hint').innerHTML = html;
  $('hint').classList.toggle('aha', aha);
  if (tr) $('hint').dataset.tr = tr;
  else delete $('hint').dataset.tr;
}

export const panel = () => $('panel');
export const foot = (html: string) => `<div class="ip-foot">${html}</div>`;
