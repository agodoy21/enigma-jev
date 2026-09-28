/**
 * The CPU steps behind the web page, off the server thread. The server sends
 * one step at a time (a share of a Bombe run or of the ciphertext-only climb,
 * or a plugboard replay) and decides the next one after asking Jev. Progress
 * is posted as it happens; each step ends with one `result` message.
 */

import { bombe } from '../break/bombe.js';
import { scanAndClimb } from '../break/climb.js';
import { type Candidate, climbPlugs, compile, identity, scrambler, toLetters, triScore } from '../break/engine.js';
import { clean, parsePlugboard, plugboardString } from '../enigma/machine.js';
import { distinct } from '../jev/judge.js';
import { type LanguageModel, languageModel } from '../lang/ngrams.js';
import { freeGermanness, knownOrder, ordersFor } from '../pipeline/tiers.js';
import type { CandidateView, Step, WorkerMessage } from './events.js';

export type { CandidateView, Step } from './events.js';

declare const self: Worker;
const post = (m: WorkerMessage) => self.postMessage(m);
export const view = (c: Candidate, lm?: LanguageModel): CandidateView => ({
  key: c.key,
  plaintext: c.plaintext,
  via: c.via,
  score: c.score,
  germanness: freeGermanness(c, lm),
  seedPlugboard: c.seedPlugboard,
  locked: c.locked,
});

self.onmessage = (e: MessageEvent<Step>) => {
  try {
    post({ type: 'result', ...run(e.data) });
  } catch (err) {
    post({ type: 'result', error: String(err) });
  }
};

function throttle(f: (done: number, total: number, extra?: string) => void) {
  let last = 0;
  return (done: number, total: number, extra?: string) => {
    const now = performance.now();
    if (now - last > 120 || done === total) {
      last = now;
      f(done, total, extra);
    }
  };
}

/** A result message without its `type` tag (distributes over the result variants). */
type ResultBody = WorkerMessage extends infer M ? (M extends { type: 'result' } ? Omit<M, 'type'> : never) : never;

function run(step: Step): ResultBody {
  // Candidates are ranked and plugboards completed in the plaintext's language.
  const lm = languageModel(step.lang ?? 'de'),
    ct = clean(step.ciphertext);
  if (step.op === 'replay') return replay(ct, step.candidate, lm);
  const orders = ordersFor(step.machine, step.date).slice(...step.slice);
  const t0 = performance.now();
  if (step.op === 'bombe') {
    let stops = 0;
    const progress = throttle((done, total) =>
      post({ type: 'progress', done, total, order: orders[done - 1].rotors.join('-'), stops }),
    );
    const r = bombe(ct, step.crib, step.at, { orders }, lm, {
      turnovers: step.turnovers,
      onStop: () => {
        stops++;
      },
      onProgress: (_s, done, total) => progress(done, total),
    });
    return {
      stops: r.stops,
      ms: Math.round(performance.now() - t0),
      candidates: distinct(r.candidates, 3).map(c => view(c, lm)),
    };
  }
  const progress = throttle((done, total, stage) => post({ type: 'progress', stage, done, total }));
  const r = scanAndClimb(ct, { orders }, lm, { onProgress: (stage, done, total) => progress(done, total, stage) });
  return { ms: Math.round(performance.now() - t0), candidates: distinct(r.candidates, 3).map(c => view(c, lm)) };
}

/**
 * Re-run the plugboard climb for the winning rotor setting, recording each
 * improvement, so the page can show the text resolving as plugs are found.
 */
function replay(ct: string, c: CandidateView, lm: LanguageModel) {
  const cipher = toLetters(ct),
    n = cipher.length;
  const four = c.key.rotors.length === 4;
  const S = scrambler(
    compile(knownOrder(c.key)),
    four ? c.key.positions[0] : 0,
    c.key.rings.slice(four ? 1 : 0),
    c.key.positions.slice(four ? 1 : 0),
    n,
  );
  const start = c.seedPlugboard !== undefined ? parsePlugboard(c.seedPlugboard) : identity();
  const locked = c.locked
    ? Uint8Array.from({ length: 26 }, (_, i) => (c.locked!.includes(String.fromCharCode(65 + i)) ? 1 : 0))
    : undefined;
  const out = new Uint8Array(n);
  const text = (p: Uint8Array) => {
    for (let i = 0; i < n; i++) out[i] = p[S[i * 26 + p[cipher[i]]]];
    return String.fromCharCode(...Array.from(out, x => x + 65));
  };
  const frames = [{ plugboard: plugboardString(start), plaintext: text(start) }];
  climbPlugs(
    S,
    cipher,
    start,
    o => triScore(lm.tri, o),
    10,
    locked,
    p => frames.push({ plugboard: plugboardString(p), plaintext: text(p) }),
  );
  if (frames.at(-1)!.plaintext !== c.plaintext) frames.push({ plugboard: c.key.plugboard, plaintext: c.plaintext });
  // First, last and an even sample between: enough to watch, few enough to send.
  const step = Math.ceil(frames.length / 38);
  const keep =
    frames.length <= 40 ? frames : frames.filter((_, i) => i === 0 || i === frames.length - 1 || i % step === 0);
  return { locked: c.locked ?? '', frames: keep };
}
