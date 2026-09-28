/**
 * A fixed pool of break workers (./break-worker.ts). A Bombe or climb run is
 * split across the pool by wheel order; progress is summed and candidates are
 * merged, best first and without duplicates.
 *
 * Where the worker script is not on disk beside this module (a bundled
 * deployment) or ENIGMA_JEV_INLINE=1, the pool runs each step in process
 * instead, yielding between wheel orders so progress still streams.
 */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { CandidateView, Step, WorkerMessage } from './events.js';
import { runStep } from './steps.js';

/** Workers a break is spread across: one per core, leaving one for the server, at most eight. */
export const POOL_SIZE = Math.max(1, Math.min(8, availableParallelism() - 1));

type Progress = Extract<WorkerMessage, { type: 'progress' }>;
type Result = Exclude<Extract<WorkerMessage, { type: 'result' }>, { error: string }>;

export interface SpreadProgress {
  done: number;
  total: number;
  order: string;
  stage: string;
  stops: number;
  workers: number;
}

/** Best candidates first, one per distinct plaintext. */
export function mergeCandidates(cands: CandidateView[], keep = 3): CandidateView[] {
  return [...cands]
    .sort((x, y) => y.score - x.score)
    .filter((c, i, all) => all.findIndex(o => o.plaintext === c.plaintext) === i)
    .slice(0, keep);
}

export class WorkerPool {
  private readonly workers: Worker[];
  /** True when steps run in this process rather than on workers. */
  readonly inline: boolean;

  constructor(size = POOL_SIZE) {
    const url = new URL('./break-worker.ts', import.meta.url);
    this.inline = process.env.ENIGMA_JEV_INLINE === '1' || !existsSync(fileURLToPath(url));
    this.workers = this.inline ? [] : Array.from({ length: size }, () => new Worker(url.href));
  }

  get size(): number {
    return this.inline ? 1 : this.workers.length;
  }

  /** Run one step on one worker. */
  call<R extends Result = Result>(step: Step, onProgress: (p: Progress) => void = () => {}, index = 0): Promise<R> {
    if (this.inline) return runInline<R>(step, onProgress);
    const w = this.workers[index];
    return new Promise<R>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m);
        else if ('error' in m) reject(new Error(m.error));
        else resolve(m as R);
      };
      w.postMessage(step);
    });
  }

  /**
   * Split a run over `orders` wheel orders across the pool. `onProgress` is throttled to one
   * report every 120 ms, summed over workers.
   */
  async spread(
    orders: number,
    make: (slice: [number, number]) => Step,
    onProgress: (p: SpreadProgress) => void,
  ): Promise<{ candidates: CandidateView[]; stops: number }> {
    const share = Math.ceil(orders / this.size);
    const slices = Array.from(
      { length: this.size },
      (_, i) => [i * share, Math.min(orders, (i + 1) * share)] as [number, number],
    ).filter(([a, b]) => a < b);
    const seen = slices.map(() => ({ done: 0, stops: 0 }));
    let last = 0;
    let order = '';
    let stage = '';
    const results = await Promise.all(
      slices.map((slice, i) =>
        this.call<Extract<Result, { candidates: CandidateView[] }>>(
          make(slice),
          p => {
            seen[i] = { done: p.done, stops: p.stops ?? 0 };
            order = p.order ?? order;
            stage = p.stage ?? stage;
            const now = performance.now();
            if (now - last < 120) return;
            last = now;
            onProgress({
              done: seen.reduce((n, x) => n + x.done, 0),
              total: orders,
              order,
              stage,
              stops: seen.reduce((n, x) => n + x.stops, 0),
              workers: slices.length,
            });
          },
          i,
        ),
      ),
    );
    return {
      candidates: mergeCandidates(results.flatMap(r => r.candidates)),
      stops: results.reduce((n, r) => n + (r.stops ?? 0), 0),
    };
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
  }
}

/** Wheel orders per in-process Bombe chunk: about one worker's share on an eight-core machine. */
const INLINE_CHUNK = 8;

/**
 * One step in this process. A Bombe step runs in chunks of wheel orders with a yield between
 * them, so the event stream can flush progress while the search runs. The climb ranks its
 * candidates across all its orders at once, so it runs whole.
 */
async function runInline<R extends Result>(step: Step, onProgress: (p: Progress) => void): Promise<R> {
  const tick = () => new Promise<void>(r => setTimeout(r, 0));
  if (step.op !== 'bombe') {
    await tick();
    return check<R>(runStep(step, m => m.type === 'progress' && onProgress(m)));
  }
  const [from, to] = step.slice;
  const parts: Extract<Result, { candidates: CandidateView[] }>[] = [];
  let stops = 0;
  for (let a = from; a < to; a += INLINE_CHUNK) {
    const b = Math.min(to, a + INLINE_CHUNK);
    await tick();
    const r = check<Extract<Result, { candidates: CandidateView[] }>>(runStep({ ...step, slice: [a, b] }, () => {}));
    parts.push(r);
    stops += r.stops ?? 0;
    onProgress({ type: 'progress', done: b - from, total: to - from, stops });
  }
  return {
    ms: parts.reduce((n, r) => n + r.ms, 0),
    stops,
    candidates: mergeCandidates(parts.flatMap(r => r.candidates)),
  } as R;
}

function check<R>(r: ReturnType<typeof runStep>): R {
  if ('error' in r) throw new Error(r.error);
  return r as R;
}
