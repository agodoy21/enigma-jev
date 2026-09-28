/**
 * A break worker: runs the steps the server sends (./steps.ts) off the server
 * thread, one at a time. Progress is posted as it happens; each step ends with
 * one `result` message.
 */
import type { Step, WorkerMessage } from './events.js';
import { runStep } from './steps.js';

export type { CandidateView, Step } from './events.js';

declare const self: Worker;
const post = (m: WorkerMessage) => self.postMessage(m);

self.onmessage = (e: MessageEvent<Step>) => {
  try {
    post({ type: 'result', ...runStep(e.data, post) });
  } catch (err) {
    post({ type: 'result', error: String(err) });
  }
};
