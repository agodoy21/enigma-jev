/**
 * The backtest: every case through every tier, Jev ranking cribs before the
 * Bombe and judging each tier's candidates after it.
 *
 * Scored per case and tier:
 *   broken        best candidate (by n-gram score) matches ≥ 90% of the known plaintext
 *   jev verdict   right when Jev accepts a ≥ 90% candidate, or accepts none when no shown candidate is
 *                 (accepted = P(pick) ≥ 0.5 and P(correct) ≥ 0.5; the raw argmax is scored too)
 *   n-gram verdict the same rule for the baseline judge: accept the top candidate when German-ness ≥ ACCEPT
 *   brier         Jev's per-candidate P(correct) against the truth
 *   crib rank     where the true opening crib sat in Jev's order and in the static order
 */
import { availableParallelism } from 'node:os';
import type { JevModel } from '../jev/client.js';
import { CRIBS, type CribRanking, rankCribs } from '../jev/cribs.js';
import { distinct, judge, type Verdict } from '../jev/judge.js';
import { ACCEPT, freeGermanness, type TierName, type TierResult } from '../pipeline/tiers.js';
import { accuracy, type Case, trueCrib } from './cases.js';
import type { Job, JobResult } from './worker.js';

export const GOOD = 0.9;

export interface TierRow {
  readonly tier: TierName;
  readonly broken: boolean;
  readonly accuracy: number;
  readonly germanness: number;
  readonly ms: number;
  readonly note?: string;
  readonly cribsTried?: string[];
  readonly bestKey?: string;
  readonly ngramRight?: boolean;
  readonly jev?: {
    readonly right: boolean;
    readonly rightArgmax: boolean;
    readonly accepted: number;
    readonly pick: number;
    readonly pickProbability: number;
    readonly none: number;
    readonly readable: number[];
    readonly shownAccuracy: number[];
    readonly error?: string;
  };
}

export interface CaseRow {
  readonly id: string;
  readonly title: string;
  readonly kind: Case['kind'];
  readonly machine: string;
  readonly service: string;
  readonly letters: number;
  readonly plugs: number;
  readonly notes?: string;
  readonly trueCrib: string | null;
  readonly cribRankJev: number | null;
  readonly cribRankStatic: number | null;
  readonly cribSource: CribRanking['source'];
  readonly tiers: TierRow[];
  readonly error?: string;
}

export interface BacktestOptions {
  readonly tiers: readonly TierName[];
  readonly jev: JevModel | null;
  readonly concurrency?: number;
  readonly maxCribs?: number;
  readonly onRow?: (row: CaseRow) => void;
}

/** Jev requests go one or two at a time, however many workers are busy. */
function limiter(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(f: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>(r => queue.push(r));
    active++;
    try {
      return await f();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

export async function runBacktest(cases: Case[], opts: BacktestOptions): Promise<CaseRow[]> {
  const jevSlot = limiter(2);
  const size = Math.max(1, Math.min(opts.concurrency ?? Math.max(1, availableParallelism() - 2), cases.length));
  const workers = Array.from({ length: size }, () => new Worker(new URL('./worker.ts', import.meta.url).href));
  const idle = [...workers];
  const waiting: Array<(w: Worker) => void> = [];
  const acquire = () =>
    new Promise<Worker>(r => {
      const w = idle.pop();
      if (w) r(w);
      else waiting.push(r);
    });
  const release = (w: Worker) => {
    const next = waiting.shift();
    if (next) next(w);
    else idle.push(w);
  };
  const runJob = (job: Job) =>
    acquire().then(
      w =>
        new Promise<JobResult>(resolve => {
          w.onmessage = (e: MessageEvent<JobResult>) => {
            release(w);
            resolve(e.data);
          };
          w.postMessage(job);
        }),
    );

  const rows = await Promise.all(
    cases.map(async (c, id): Promise<CaseRow> => {
      const cribTexts = CRIBS.map(k => k.text);
      const truth = trueCrib(c.plaintext, cribTexts);
      const ctx = { service: c.service, date: c.date, machine: c.machine };
      const staticRank = await rankCribs(c.ciphertext, ctx, null);
      let ranking = staticRank;
      if (opts.jev && opts.tiers.includes('bombe')) {
        try {
          ranking = await jevSlot(() => rankCribs(c.ciphertext, ctx, opts.jev));
        } catch {
          ranking = staticRank;
        }
      }
      const rankOf = (r: CribRanking) => (truth ? r.order.findIndex(k => k.text === truth) + 1 || null : null);
      const res = await runJob({
        id,
        c,
        tiers: opts.tiers,
        cribs: ranking.order.map(k => k.text),
        maxCribs: opts.maxCribs ?? 3,
      });
      const tiers = await Promise.all(res.results.map(r => scoreTier(c, r, opts.jev, jevSlot)));
      const row: CaseRow = {
        id: c.id,
        title: c.title,
        kind: c.kind,
        machine: c.machine,
        service: c.service,
        letters: c.ciphertext.length,
        plugs: c.plugs,
        notes: c.notes,
        trueCrib: truth,
        cribRankJev: ranking.source === 'jev' ? rankOf(ranking) : null,
        cribRankStatic: rankOf(staticRank),
        cribSource: ranking.source,
        tiers,
        error: res.error,
      };
      opts.onRow?.(row);
      return row;
    }),
  );
  for (const w of workers) w.terminate();
  return rows;
}

async function scoreTier(
  c: Case,
  r: TierResult,
  jev: JevModel | null,
  slot: ReturnType<typeof limiter>,
): Promise<TierRow> {
  const best = r.candidates[0];
  const acc = best ? accuracy(best.plaintext, c.plaintext) : 0;
  const g = best ? freeGermanness(best) : 0;
  const base: TierRow = {
    tier: r.tier,
    broken: acc >= GOOD,
    accuracy: acc,
    germanness: g,
    ms: Math.round(r.ms),
    note: r.note,
    cribsTried: r.cribsTried,
    bestKey: best?.key
      ? `${best.key.rotors.join('-')} rings ${best.key.rings.map(x => String.fromCharCode(65 + x)).join('')} start ${best.key.positions.map(x => String.fromCharCode(65 + x)).join('')} plugs ${best.key.plugboard}`
      : undefined,
  };
  if (r.tier === 'verify' || !best) return base;
  const shown = distinct(r.candidates, 3);
  const shownAccuracy = shown.map(s => accuracy(s.plaintext, c.plaintext));
  const anyGood = shownAccuracy.some(a => a >= GOOD);
  const ngramRight = g >= ACCEPT ? acc >= GOOD : !anyGood;
  if (!jev) return { ...base, ngramRight };
  try {
    const v: Verdict = await slot(() => judge(jev, c.ciphertext, shown));
    const rightWhen = (k: number) => (k >= 0 ? shownAccuracy[k] >= GOOD : !anyGood);
    return {
      ...base,
      ngramRight,
      jev: {
        right: rightWhen(v.accepted),
        rightArgmax: rightWhen(v.pick),
        accepted: v.accepted,
        pick: v.pick,
        pickProbability: v.pickProbability,
        none: v.noneProbability,
        readable: v.readable,
        shownAccuracy,
      },
    };
  } catch (err) {
    return {
      ...base,
      ngramRight,
      jev: {
        right: false,
        rightArgmax: false,
        accepted: -2,
        pick: -2,
        pickProbability: 0,
        none: 0,
        readable: [],
        shownAccuracy,
        error: String(err).slice(0, 200),
      },
    };
  }
}

export interface Summary {
  readonly byTier: Record<
    string,
    {
      cases: number;
      broken: number;
      jevRight: number;
      jevArgmaxRight: number;
      jevJudged: number;
      ngramRight: number;
      brier: number | null;
      brierN: number;
      medianMs: number;
    }
  >;
  readonly crib: {
    withTrueCrib: number;
    jevMeanRank: number | null;
    staticMeanRank: number | null;
    jevTop1: number;
    staticTop1: number;
  };
}

export function summarize(rows: CaseRow[]): Summary {
  const byTier: Summary['byTier'] = {};
  for (const row of rows)
    for (const t of row.tiers) {
      byTier[t.tier] ??= {
        cases: 0,
        broken: 0,
        jevRight: 0,
        jevArgmaxRight: 0,
        jevJudged: 0,
        ngramRight: 0,
        brier: 0,
        brierN: 0,
        medianMs: 0,
      };
      const s = byTier[t.tier];
      s.cases++;
      if (t.broken) s.broken++;
      if (t.ngramRight) s.ngramRight++;
      if (t.jev && t.jev.pick !== -2) {
        s.jevJudged++;
        if (t.jev.right) s.jevRight++;
        if (t.jev.rightArgmax) s.jevArgmaxRight++;
        t.jev.readable.forEach((p, k) => {
          if (Number.isFinite(p)) {
            s.brier! += (p - (t.jev!.shownAccuracy[k] >= GOOD ? 1 : 0)) ** 2;
            s.brierN++;
          }
        });
      }
    }
  for (const [tier, s] of Object.entries(byTier)) {
    s.brier = s.brierN ? s.brier! / s.brierN : null;
    const times = rows.flatMap(r => r.tiers.filter(t => t.tier === tier).map(t => t.ms)).sort((a, b) => a - b);
    s.medianMs = times[Math.floor(times.length / 2)] ?? 0;
  }
  const withCrib = rows.filter(r => r.trueCrib && r.cribRankStatic);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const jevRanks = withCrib.map(r => r.cribRankJev).filter((x): x is number => x !== null);
  return {
    byTier,
    crib: {
      withTrueCrib: withCrib.length,
      jevMeanRank: mean(jevRanks),
      staticMeanRank: mean(withCrib.map(r => r.cribRankStatic!)),
      jevTop1: jevRanks.filter(x => x === 1).length,
      staticTop1: withCrib.filter(r => r.cribRankStatic === 1).length,
    },
  };
}
