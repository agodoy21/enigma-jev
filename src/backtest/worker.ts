/** Runs the CPU tiers for one case off the main thread. */
import {
  knownOrder,
  runBombe,
  runClimb,
  runKey,
  runKnownCrib,
  runVerify,
  type TierName,
  type TierResult,
} from '../pipeline/tiers.js';
import type { Case } from './cases.js';

export interface Job {
  readonly id: number;
  readonly c: Case;
  readonly tiers: readonly TierName[];
  readonly cribs: readonly string[];
  readonly maxCribs: number;
}
export interface JobResult {
  readonly id: number;
  readonly results: TierResult[];
  readonly error?: string;
}

declare const self: Worker;

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, c, tiers, cribs, maxCribs } = e.data;
  try {
    const results: TierResult[] = [];
    for (const tier of tiers) {
      if (tier === 'verify') results.push(runVerify(c.ciphertext, c.key));
      else if (tier === 'key') results.push(runKey(c.ciphertext, c.key));
      else if (tier === 'crib')
        results.push(
          runKnownCrib(
            c.ciphertext,
            c.plaintext,
            c.machine,
            c.date,
            c.machine === 'M4' ? knownOrder(c.key) : undefined,
          ),
        );
      else if (tier === 'bombe')
        results.push(
          runBombe(c.ciphertext, {
            machine: c.machine,
            date: c.date,
            cribs,
            maxCribs,
            m4Order: c.machine === 'M4' ? knownOrder(c.key) : undefined,
          }),
        );
      else if (tier === 'climb') results.push(runClimb(c.ciphertext, c.machine, c.date));
    }
    self.postMessage({ id, results } satisfies JobResult);
  } catch (err) {
    self.postMessage({ id, results: [], error: String(err) } satisfies JobResult);
  }
};
