/**
 * The wire protocol of a break, shared by the server (src/web/break-stream.ts),
 * its workers (src/web/break-worker.ts) and the page (web/app/bletchley.ts).
 *
 *   POST /api/break  BreakRequest  →  text/event-stream of BreakEvent
 *
 * Each event is one `data:` line of JSON. Type-only: nothing here runs.
 */
import type { EnigmaKey } from '../enigma/machine.js';
import type { Service } from '../jev/cribs.js';
import type { Verdict } from '../jev/judge.js';
import type { Lang } from '../lang/ngrams.js';
import type { Machine } from '../pipeline/tiers.js';

export interface BreakRequest {
  readonly ciphertext: string;
  readonly service?: Service;
  readonly date?: string;
  /** TEXT, or TEXT@position. Tried first, before the crib list. */
  readonly crib?: string;
  readonly useJev?: boolean;
  readonly maxCribs?: number;
  readonly language?: Lang;
}

/** A candidate decryption as the page sees it. */
export interface CandidateView {
  key: EnigmaKey;
  plaintext: string;
  via: string;
  score: number;
  /** German-ness of the letters outside the assumed crib. */
  germanness: number;
  seedPlugboard?: string;
  locked?: string;
}

export type Turnovers = 'none' | 'all';

/** One unit of worker work. `slice` picks a share of the wheel orders, so a run can be split across workers. */
export type Step =
  | {
      op: 'bombe';
      ciphertext: string;
      machine: Machine;
      date?: string;
      crib: string;
      at: number;
      turnovers: Turnovers;
      slice: [number, number];
      lang?: Lang;
    }
  | { op: 'climb'; ciphertext: string; machine: Machine; date?: string; slice: [number, number]; lang?: Lang }
  | { op: 'replay'; ciphertext: string; candidate: CandidateView; lang?: Lang };

export interface ReplayFrame {
  plugboard: string;
  plaintext: string;
}

/** What a worker posts back: progress while it runs, then exactly one result. */
export type WorkerMessage =
  | { type: 'progress'; done: number; total: number; order?: string; stage?: string; stops?: number }
  | { type: 'result'; error: string }
  | { type: 'result'; stops?: number; ms: number; candidates: CandidateView[] }
  | { type: 'result'; locked: string; frames: ReplayFrame[] };

/** The judgement of one Bombe or climb run. */
export interface RunVerdict {
  ms: number;
  best: CandidateView | null;
  accepted: boolean;
  jev: Verdict | null;
  /** Rejected: too little text beyond the crib to judge. */
  thin: boolean;
  /** Rejected: Jev leaned yes but the letter statistics disagree (the German-ness it scored). */
  disagree: number | null;
  decidedBy?: 'jev' | 'stats';
  fit: number | null;
}

export interface RunProgress {
  done: number;
  total: number;
  order: string;
  stage: string;
  stops: number;
  workers: number;
}

export interface DraggedCrib {
  text: string;
  meaning: string;
  fits: boolean;
  /** Crib indices that would sit on their own letter. */
  clashes: number[];
  loops: number | null;
}

export type BreakEvent =
  | { type: 'intercept'; ciphertext: string; letters: number; jev: boolean; model: string | null; lang: Lang }
  | { type: 'drag'; cribs: DraggedCrib[] }
  | {
      type: 'jev-cribs';
      source: 'jev' | 'static';
      order: string[];
      probabilities: Record<string, number>;
      none: number;
      latencyMs: number | null;
    }
  | {
      type: 'bombe-start';
      crib: string;
      at: number;
      source: string;
      turnovers: Turnovers;
      loops: number;
      menu: Array<[string, string, number]>;
      orders: number;
      workers: number;
    }
  | ({ type: 'bombe-progress' } & RunProgress)
  | ({ type: 'bombe-done'; crib: string; turnovers: Turnovers; stops: number } & RunVerdict)
  | { type: 'climb-start'; orders: number; workers: number }
  | ({ type: 'climb-progress' } & RunProgress)
  | ({ type: 'climb-done' } & RunVerdict)
  | { type: 'replay'; locked: string; frames: ReplayFrame[] }
  | { type: 'candidates'; candidates: CandidateView[] }
  | ({ type: 'jev-judge'; advisory: boolean } & Verdict)
  | { type: 'note'; title: string; body: string }
  | { type: 'jev-error'; stage: 'cribs' | 'judge'; message: string }
  | { type: 'result'; chosen: number; verdict: string; candidate: CandidateView | null; jevCalls: number }
  | { type: 'error'; message: string };

export type BreakEventType = BreakEvent['type'];
export type EventOf<T extends BreakEventType> = Extract<BreakEvent, { type: T }>;
