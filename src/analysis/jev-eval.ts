/**
 * Jev performance, reconstructed from the audit log.
 *
 * Every Jev request and answer is in ~/.enigma-jev/jev-calls.jsonl. Each judge
 * state carries its ciphertext, so a call can be matched to its message and
 * every candidate scored against the known plaintext; each crib state can be
 * scored against the message's true opening. Nothing here asks Jev anything.
 *
 *   bun run src/analysis/jev-eval.ts      → reports/jev-analysis.json
 *
 * Phases, by time against the backtest reports:
 *   pilot     the first backtest, before crib marking in the judge state and before the decision rule
 *   main      the main backtest (historical + synthetic, seed 1941)
 *   holdout   the holdout backtest (synthetic, seed 2024: new keys, same texts)
 *   web       page runs on historical intercepts during the holdout window
 * "eval" pools main and holdout.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { accuracy, type Case, historicalCases, syntheticCases } from '../backtest/cases.js';
import { JEV_ACCEPT } from '../jev/judge.js';
import { german, germanness, trainingText } from '../lang/ngrams.js';
import { ACCEPT } from '../pipeline/tiers.js';

const ROOT = join(import.meta.dir, '..', '..');
const LOG = join(process.env.ENIGMA_JEV_HOME ?? join(homedir(), '.enigma-jev'), 'jev-calls.jsonl');
const EXPERIMENTS = join(ROOT, 'reports', 'jev-experiments.json');
const OUT = join(ROOT, 'reports', 'jev-analysis.json');
/** The same candidates, with text and every judge's score, for the classifier comparison (analysis/judges.py). */
const DATASET = join(ROOT, 'reports', 'judge-dataset.json');
const GOOD = 0.9;

type Phase = 'pilot' | 'main' | 'holdout' | 'web';
interface Cand {
  label: string;
  text: string;
  cribStart: number;
  cribLen: number;
  p: number;
  g: number;
  acc: number;
  y: 0 | 1;
}
interface JudgeCall {
  id: string;
  at: string;
  phase: Phase;
  caseId: string;
  kind: Case['kind'];
  pick: string;
  pickP: number;
  noneP: number;
  cands: Cand[];
  latencyMs: number;
  inTok: number;
  outTok: number;
}
interface CribCall {
  id: string;
  at: string;
  phase: Phase;
  caseId: string;
  kind: Case['kind'];
  options: string[];
  probs: number[];
  none: number;
  truth: string | null;
  latencyMs: number;
  inTok: number;
  outTok: number;
}

// ─────────────────────────── statistics ───────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const brier = (p: number[], y: number[]) => mean(p.map((x, i) => (x - y[i]) ** 2));
const logLoss = (p: number[], y: number[]) =>
  mean(
    p.map((x, i) => {
      const q = Math.min(1 - 1e-3, Math.max(1e-3, x));
      return -(y[i] ? Math.log(q) : Math.log(1 - q));
    }),
  );
/** Mann–Whitney AUC with ties counted half. */
function auc(p: number[], y: number[]): number {
  const pos = p.filter((_, i) => y[i]),
    neg = p.filter((_, i) => !y[i]);
  if (!pos.length || !neg.length) return NaN;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
}
function roc(p: number[], y: number[]): Array<[number, number]> {
  const thr = [Infinity, ...[...new Set(p)].sort((a, b) => b - a), -Infinity];
  const P = y.filter(Boolean).length,
    N = y.length - P;
  return thr.map(
    t =>
      [p.filter((x, i) => x >= t && !y[i]).length / N, p.filter((x, i) => x >= t && y[i]).length / P] as [
        number,
        number,
      ],
  );
}
function reliability(p: number[], y: number[], bins = 10) {
  const out = Array.from({ length: bins }, (_, b) => ({ lo: b / bins, hi: (b + 1) / bins, n: 0, meanP: 0, rate: 0 }));
  p.forEach((x, i) => {
    const b = Math.min(bins - 1, Math.floor(x * bins));
    out[b].n++;
    out[b].meanP += x;
    out[b].rate += y[i];
  });
  for (const b of out)
    if (b.n) {
      b.meanP /= b.n;
      b.rate /= b.n;
    }
  const ece = out.reduce((s, b) => s + (b.n / p.length) * Math.abs(b.rate - b.meanP), 0);
  return { bins: out, ece };
}
/** Murphy (1973): Brier = reliability − resolution + uncertainty, on the same bins. */
function murphy(p: number[], y: number[], bins = 10) {
  const base = mean(y),
    { bins: bs } = reliability(p, y, bins);
  const rel = bs.reduce((s, b) => s + (b.n / p.length) * (b.meanP - b.rate) ** 2, 0);
  const res = bs.reduce((s, b) => s + (b.n / p.length) * (b.rate - base) ** 2, 0);
  return { reliability: rel, resolution: res, uncertainty: base * (1 - base) };
}
/** One-feature logistic regression by Newton's method (Platt scaling). */
function fitLogistic(x: number[], y: number[]): [number, number] {
  let a = 0,
    b = 0;
  for (let it = 0; it < 50; it++) {
    let ga = 0,
      gb = 0,
      haa = 1e-6,
      hab = 0,
      hbb = 1e-6;
    x.forEach((xi, i) => {
      const p = 1 / (1 + Math.exp(-(a + b * xi))),
        w = p * (1 - p);
      ga += y[i] - p;
      gb += (y[i] - p) * xi;
      haa += w;
      hab += w * xi;
      hbb += w * xi * xi;
    });
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det,
      db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return [a, b];
}
function bootstrap<T>(units: T[], stat: (s: T[]) => number, reps = 2000, seed = 7): [number, number] {
  const r = rng(seed),
    vals: number[] = [];
  for (let k = 0; k < reps; k++) {
    const s = units.map(() => units[Math.floor(r() * units.length)]);
    const v = stat(s);
    if (Number.isFinite(v)) vals.push(v);
  }
  return [quantile(vals, 0.025), quantile(vals, 0.975)];
}

// ─────────────────────────── reading the log ───────────────────────────
/**
 * Run boundaries. Every backtest opens by ranking cribs for all its messages at
 * once, so each run starts with a burst of crib calls (25 for the main set, 16
 * for a synthetic set). Report timestamps give the ends; their elapsed-time
 * fields cannot place the starts, because the monotonic clock stops while the
 * machine sleeps.
 */
function runWindows(requests: Array<{ at: string; questions: Record<string, unknown> }>) {
  const dir = join(ROOT, 'reports');
  const reports = readdirSync(dir)
    .filter(f => /^backtest-.*\.json$/.test(f))
    .map(f => {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return {
        file: f,
        end: Date.parse(f.slice(9, 28).replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3') + 'Z') + 1000,
        meta: r.meta,
        historical: !!r.summaries.historical,
      };
    })
    .filter(r => r.meta.jev)
    .sort((x, y) => x.end - y.end);
  const cribTimes = requests.filter(r => r.questions.crib).map(r => Date.parse(r.at));
  const bursts: Array<{ start: number; size: number }> = [];
  for (let i = 0; i < cribTimes.length; ) {
    let j = i;
    while (j + 1 < cribTimes.length && cribTimes[j + 1] - cribTimes[i] < 8000) j++;
    if (j - i + 1 >= 10) bursts.push({ start: cribTimes[i], size: j - i + 1 });
    i = j + 1;
  }
  const main = reports.filter(r => r.historical).at(-1);
  const holdout = reports.filter(r => !r.historical && r.meta.seed !== 1941).at(-1);
  const startBefore = (end: number, size: number) => bursts.filter(b => b.start < end && b.size === size).at(-1)?.start;
  const mainStart = main ? startBefore(main.end, main.meta.cases) : undefined;
  const holdStart = holdout ? startBefore(holdout.end, holdout.meta.cases) : undefined;
  const pilotStart = mainStart ? bursts.filter(b => b.start < mainStart).at(-1)?.start : undefined;
  return {
    main:
      main && mainStart
        ? { file: main.file, start: mainStart, end: main.end, seed: main.meta.seed as number }
        : undefined,
    holdout:
      holdout && holdStart
        ? { file: holdout.file, start: holdStart, end: holdout.end, seed: holdout.meta.seed as number }
        : undefined,
    pilot: pilotStart && mainStart ? { start: pilotStart, end: mainStart } : undefined,
  };
}

export function analyse() {
  const lines = readFileSync(LOG, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));
  const responses = new Map(lines.filter(l => l.kind === 'response').map(l => [l.requestId, l]));
  const requests = lines.filter(l => l.kind === 'request' && responses.has(l.requestId));
  const { main, holdout, pilot } = runWindows(requests);
  const hist = historicalCases(),
    syn1941 = syntheticCases(1941),
    syn2024 = syntheticCases(holdout?.seed ?? 2024);
  const lm = german();

  const phaseOf = (at: string): Phase | null => {
    const t = Date.parse(at);
    if (pilot && t >= pilot.start && t < pilot.end) return 'pilot';
    if (main && t >= main.start && t <= main.end) return 'main';
    if (holdout && t >= holdout.start && t <= holdout.end) return 'holdout';
    return 'web';
  };
  const poolFor = (phase: Phase) => (phase === 'holdout' ? syn2024 : phase === 'web' ? hist : [...hist, ...syn1941]);
  const match = (pool: Case[], ct: string, n: number) =>
    pool.find(c => c.ciphertext.length === n && c.ciphertext.startsWith(ct));
  /** A call inside a run window that matches none of that run's messages is a page run on a historical intercept, or unlabelled. */
  const locate = (ct: string, n: number, at: string): { c: Case; phase: Phase } | null => {
    const phase = phaseOf(at);
    if (!phase) return null;
    const c = match(poolFor(phase), ct, n);
    if (c) return { c, phase };
    const h = match(hist, ct, n);
    return h ? { c: h, phase: 'web' } : null;
  };

  const judges: JudgeCall[] = [],
    cribs: CribCall[] = [];
  let unmatched = 0;
  for (const req of requests) {
    const res = responses.get(req.requestId)!;
    const usage = res.answers.usage ?? {};
    if (req.questions.pick) {
      const m = /Ciphertext \((\d+) letters\): ([A-Z]+)/.exec(req.state);
      const hit = m && locate(m[2], Number(m[1]), req.at);
      if (!hit) {
        unmatched++;
        continue;
      }
      const { c, phase } = hit;
      const a = res.answers.answers;
      const cands: Cand[] = [];
      for (const line of req.state.split('\n')) {
        const cm = /^Candidate ([A-D])(?: \(letters (\d+)–(\d+) were assumed[^)]*\))?: ([A-Z]+)/.exec(line);
        if (!cm) continue;
        const text = cm[4],
          cribStart = cm[2] ? Number(cm[2]) - 1 : 0,
          cribLen = cm[2] ? Number(cm[3]) - Number(cm[2]) + 1 : 0;
        const acc = accuracy(text, c.plaintext.slice(0, text.length));
        const free = text.slice(0, cribStart) + text.slice(cribStart + cribLen);
        cands.push({
          label: cm[1],
          text,
          cribStart,
          cribLen,
          p: a[`readable_${cm[1]}`]?.noul ?? NaN,
          g: germanness(lm, free),
          acc,
          y: acc >= GOOD ? 1 : 0,
        });
      }
      judges.push({
        id: req.requestId,
        at: req.at,
        phase,
        caseId: c.id,
        kind: c.kind,
        pick: a.pick.choice,
        pickP: a.pick.probabilities[a.pick.choice] ?? 0,
        noneP: a.pick.probabilities.none ?? 0,
        cands,
        latencyMs: res.latencyMs,
        inTok: usage.input_tokens ?? 0,
        outTok: usage.output_tokens ?? 0,
      });
    } else if (req.questions.crib) {
      const m = /body is (\d+) letters long[\s\S]*First ciphertext letters: ([A-Z]+)/.exec(req.state);
      const hit = m && locate(m[2], Number(m[1]), req.at);
      if (!hit) {
        unmatched++;
        continue;
      }
      const { c, phase } = hit;
      const crit = req.questions.crib.criteria as Record<string, string>;
      const keys = Object.keys(crit).filter(k => k !== 'none');
      const options = keys.map(k => /begins with ([A-Z]+):/.exec(crit[k])![1]);
      const probs = keys.map(k => res.answers.answers.crib.probabilities[k] ?? 0);
      const truth = options.filter(o => c.plaintext.startsWith(o)).sort((x, y) => y.length - x.length)[0] ?? null;
      cribs.push({
        id: req.requestId,
        at: req.at,
        phase,
        caseId: c.id,
        kind: c.kind,
        options,
        probs,
        none: res.answers.answers.crib.probabilities.none ?? 0,
        truth,
        latencyMs: res.latencyMs,
        inTok: usage.input_tokens ?? 0,
        outTok: usage.output_tokens ?? 0,
      });
    }
  }

  // ── candidate-level: discrimination and calibration, Jev against a calibrated n-gram judge
  const evalJ = judges.filter(j => j.phase === 'main' || j.phase === 'holdout');
  const flat = (js: JudgeCall[]) =>
    js.flatMap(j =>
      j.cands.filter(c => Number.isFinite(c.p)).map(c => ({ ...c, caseId: `${j.phase}:${j.caseId}`, call: j.id })),
    );
  const evalC = flat(evalJ);
  // Leave-one-message-out Platt scaling of German-ness, so the n-gram judge is scored on messages it was not fitted to.
  const cases = [...new Set(evalC.map(c => c.caseId))];
  const pNgram = new Map<object, number>();
  for (const cid of cases) {
    const train = evalC.filter(c => c.caseId !== cid);
    const [a, b] = fitLogistic(
      train.map(c => c.g),
      train.map(c => c.y),
    );
    for (const c of evalC.filter(c => c.caseId === cid)) pNgram.set(c, 1 / (1 + Math.exp(-(a + b * c.g))));
  }
  // The same leave-one-message-out Platt scaling applied to Jev's own P(correct): a monotone map, so ranking is untouched.
  const pJevCal = new Map<object, number>();
  for (const cid of cases) {
    const train = evalC.filter(c => c.caseId !== cid);
    const [a, b] = fitLogistic(
      train.map(c => c.p),
      train.map(c => c.y),
    );
    for (const c of evalC.filter(c => c.caseId === cid)) pJevCal.set(c, 1 / (1 + Math.exp(-(a + b * c.p))));
  }
  const y = evalC.map(c => c.y),
    pJ = evalC.map(c => c.p),
    pN = evalC.map(c => pNgram.get(c)!),
    gRaw = evalC.map(c => c.g);
  const byCall = evalJ.map(j => j.id);
  const statOn = (ids: string[], f: (cs: typeof evalC) => number) =>
    f(ids.flatMap(id => evalC.filter(c => c.call === id)));
  const ci = (f: (cs: typeof evalC) => number) => bootstrap(byCall, ids => statOn(ids, f));
  const judgeMetrics = (p: (c: (typeof evalC)[number]) => number) => ({
    auc: auc(evalC.map(p), y),
    aucCI: ci(cs =>
      auc(
        cs.map(p),
        cs.map(c => c.y),
      ),
    ),
    brier: brier(evalC.map(p), y),
    brierCI: ci(cs =>
      brier(
        cs.map(p),
        cs.map(c => c.y),
      ),
    ),
    logLoss: logLoss(evalC.map(p), y),
    ...reliability(evalC.map(p), y),
    murphy: murphy(evalC.map(p), y),
  });
  const candidateLevel = {
    n: evalC.length,
    positives: y.filter(Boolean).length,
    calls: evalJ.length,
    messages: cases.length,
    baseRate: mean(y),
    jev: judgeMetrics(c => c.p),
    ngram: judgeMetrics(c => pNgram.get(c)!),
    jevRecalibrated: judgeMetrics(c => pJevCal.get(c)!),
    ngramRawAuc: auc(gRaw, y),
    constant: {
      brier: brier(
        y.map(() => mean(y)),
        y,
      ),
      logLoss: logLoss(
        y.map(() => mean(y)),
        y,
      ),
    },
    roc: { jev: roc(pJ, y), ngram: roc(pN, y) },
    // Candidate points for the figures (a sample is fine; all are kept, 478 rows).
    points: evalC.map(c => ({
      p: c.p,
      pn: pNgram.get(c)!,
      pc: pJevCal.get(c)!,
      g: c.g,
      y: c.y,
      acc: c.acc,
      phase: c.caseId.split(':')[0],
    })),
  };

  // ── call-level decisions
  const pOfNgram = (j: JudgeCall, k: number) => {
    const c = evalC.find(x => x.call === j.id && x.label === j.cands[k].label);
    return c ? pNgram.get(c)! : NaN;
  };
  type Rule = (j: JudgeCall) => number; // index of accepted candidate, or -1
  const idxOf = (j: JudgeCall, l: string) => j.cands.findIndex(c => c.label === l);
  const rules: Record<string, Rule> = {
    'Jev, decision rule': j => {
      const k = idxOf(j, j.pick);
      return k >= 0 && j.pickP >= JEV_ACCEPT && j.cands[k].p >= JEV_ACCEPT ? k : -1;
    },
    'Jev, top choice': j => idxOf(j, j.pick),
    'n-gram, German-ness ≥ 0.4': j => {
      let best = -1,
        bg = -Infinity;
      j.cands.forEach((c, k) => {
        if (c.g > bg) {
          bg = c.g;
          best = k;
        }
      });
      return bg >= ACCEPT ? best : -1;
    },
    'n-gram, calibrated (leave-one-message-out)': j => {
      let best = -1,
        bp = -Infinity;
      j.cands.forEach((_c, k) => {
        const p = pOfNgram(j, k);
        if (p > bp) {
          bp = p;
          best = k;
        }
      });
      return bp >= 0.5 ? best : -1;
    },
    "Accept the search's top candidate": () => 0,
  };
  const decide = (js: JudgeCall[], rule: Rule) => {
    const m = { acceptCorrect: 0, acceptWrong: 0, rejectMissed: 0, rejectRight: 0 };
    for (const j of js) {
      const k = rule(j),
        any = j.cands.some(c => c.y);
      if (k >= 0) j.cands[k].y ? m.acceptCorrect++ : m.acceptWrong++;
      else any ? m.rejectMissed++ : m.rejectRight++;
    }
    const n = js.length,
      right = m.acceptCorrect + m.rejectRight;
    return {
      ...m,
      n,
      accuracy: right / n,
      precision: m.acceptCorrect / Math.max(1, m.acceptCorrect + m.acceptWrong),
      recall: m.acceptCorrect / Math.max(1, m.acceptCorrect + m.rejectMissed),
    };
  };
  const wrongAccepts = evalJ
    .filter(j => {
      const k = rules['Jev, decision rule'](j);
      return k >= 0 && !j.cands[k].y;
    })
    .map(j => {
      const k = rules['Jev, decision rule'](j);
      return { caseId: j.caseId, phase: j.phase, accuracy: j.cands[k].acc, p: j.cands[k].p, pickP: j.pickP };
    });
  const decisions = Object.fromEntries(
    Object.entries(rules).map(([name, r]) => [
      name,
      {
        eval: { ...decide(evalJ, r), accuracyCI: bootstrap(evalJ, s => decide(s, r).accuracy) },
        main: decide(
          evalJ.filter(j => j.phase === 'main'),
          r,
        ),
        holdout: decide(
          evalJ.filter(j => j.phase === 'holdout'),
          r,
        ),
      },
    ]),
  );
  // Choice-question confidence: does P(pick) track whether the pick is right?
  const pickRows = evalJ
    .filter(j => j.pick !== 'none')
    .map(j => ({ p: j.pickP, y: j.cands[idxOf(j, j.pick)]?.y ?? 0 }));
  const noneRows = evalJ.map(j => ({ p: j.noneP, y: j.cands.some(c => c.y) ? 0 : 1 }));
  const choice = {
    pick: {
      n: pickRows.length,
      brier: brier(
        pickRows.map(r => r.p),
        pickRows.map(r => r.y),
      ),
      auc: auc(
        pickRows.map(r => r.p),
        pickRows.map(r => r.y),
      ),
    },
    none: {
      n: noneRows.length,
      brier: brier(
        noneRows.map(r => r.p),
        noneRows.map(r => r.y),
      ),
      auc: auc(
        noneRows.map(r => r.p),
        noneRows.map(r => r.y),
      ),
    },
  };
  // Where Jev's top choice lands, against where the correct candidate actually was.
  const slots = ['A', 'B', 'C', 'none'];
  const positions = {
    picks: slots.map(s => evalJ.filter(j => j.pick === s).length),
    correctAt: slots.map(s =>
      s === 'none'
        ? evalJ.filter(j => !j.cands.some(c => c.y)).length
        : evalJ.filter(j => j.cands.find(c => c.label === s)?.y).length,
    ),
  };

  // ── prompt ablation: the pilot had no crib marking and no decision rule
  const pilotJ = judges.filter(j => j.phase === 'pilot');
  const pilotC = flat(pilotJ);
  const ablation = pilotJ.length
    ? {
        pilot: {
          calls: pilotJ.length,
          candidates: pilotC.length,
          auc: auc(
            pilotC.map(c => c.p),
            pilotC.map(c => c.y),
          ),
          brier: brier(
            pilotC.map(c => c.p),
            pilotC.map(c => c.y),
          ),
          topChoice: decide(pilotJ, rules['Jev, top choice']),
          rule: decide(pilotJ, rules['Jev, decision rule']),
        },
        eval: {
          calls: evalJ.length,
          candidates: evalC.length,
          auc: candidateLevel.jev.auc,
          brier: candidateLevel.jev.brier,
          topChoice: decisions['Jev, top choice'].eval,
          rule: decisions['Jev, decision rule'].eval,
        },
        // Bombe candidates that open with a real crib: did marking the crib stop Jev being flattered by it?
        cribWrong: {
          pilotBombeWrong: mean(pilotJ.flatMap(j => j.cands.filter(c => !c.y)).map(c => c.p)),
          evalBombeWrong: mean(evalJ.flatMap(j => j.cands.filter(c => !c.y && c.cribLen > 0)).map(c => c.p)),
          evalOtherWrong: mean(evalJ.flatMap(j => j.cands.filter(c => !c.y && c.cribLen === 0)).map(c => c.p)),
          evalAllWrong: mean(evalJ.flatMap(j => j.cands.filter(c => !c.y)).map(c => c.p)),
          pilotCorrect: mean(pilotJ.flatMap(j => j.cands.filter(c => c.y)).map(c => c.p)),
          evalCorrect: mean(evalJ.flatMap(j => j.cands.filter(c => c.y)).map(c => c.p)),
        },
      }
    : null;

  // ── crib selection
  const evalK = cribs.filter(c => c.phase === 'main' || c.phase === 'holdout');
  const withTruth = evalK.filter(c => c.truth);
  const cribRows = withTruth.map(c => {
    const k = c.options.indexOf(c.truth!),
      order = c.options.map((_, i) => i).sort((a, b) => c.probs[b] - c.probs[a] || a - b);
    return {
      caseId: c.caseId,
      phase: c.phase,
      truth: c.truth!,
      options: c.options.length,
      jevRank: order.indexOf(k) + 1,
      staticRank: k + 1,
      pTrue: c.probs[k],
      uniform: 1 / (c.options.length + 1),
      top: c.options[order[0]],
      pTop: c.probs[order[0]],
    };
  });
  const noTruth = evalK.filter(c => !c.truth);
  const cribSelection = {
    calls: evalK.length,
    withTrueCrib: withTruth.length,
    rows: cribRows,
    meanRank: {
      jev: mean(cribRows.map(r => r.jevRank)),
      static: mean(cribRows.map(r => r.staticRank)),
      random: mean(cribRows.map(r => (r.options + 1) / 2)),
    },
    top3: { jev: cribRows.filter(r => r.jevRank <= 3).length, static: cribRows.filter(r => r.staticRank <= 3).length },
    // Log score on the true opener (natural log), against a uniform guess over the same options plus "none".
    logScore: {
      jev: mean(cribRows.map(r => Math.log(Math.max(1e-3, r.pTrue)))),
      uniform: mean(cribRows.map(r => Math.log(r.uniform))),
    },
    none: {
      whenAbsent: mean(noTruth.map(c => c.none)),
      whenPresent: mean(withTruth.map(c => c.none)),
      absentN: noTruth.length,
      presentN: withTruth.length,
      auc: auc(
        evalK.map(c => c.none),
        evalK.map(c => (c.truth ? 0 : 1)),
      ),
    },
    concentration: {
      meanTopP: mean(evalK.map(c => Math.max(...c.probs, c.none))),
      meanOptions: mean(evalK.map(c => c.options.length)),
    },
  };

  // ── cost and latency, every call in the log
  const all = [
    ...judges.map(j => ({ type: 'judge', ms: j.latencyMs, inTok: j.inTok, outTok: j.outTok })),
    ...cribs.map(c => ({ type: 'crib', ms: c.latencyMs, inTok: c.inTok, outTok: c.outTok })),
  ];
  const latency = Object.fromEntries(
    ['judge', 'crib'].map(t => {
      const r = all.filter(x => x.type === t),
        ms = r.map(x => x.ms);
      return [
        t,
        {
          n: r.length,
          p50: quantile(ms, 0.5),
          p90: quantile(ms, 0.9),
          max: Math.max(...ms),
          inTok: mean(r.map(x => x.inTok)),
          outTok: mean(r.map(x => x.outTok)),
          ms,
        },
      ];
    }),
  );

  // Two real calls, shown verbatim (candidate texts shortened) to illustrate the interface.
  const reqOf = new Map(requests.map(r => [r.requestId, r]));
  const exJ =
    evalJ.find(j => j.caseId === 'barbarossa-1941-part1' && j.cands.some(c => c.y && c.cribLen > 0)) ??
    evalJ.find(j => j.cands.some(c => c.y));
  const exK = evalK.find(c => c.caseId === 'u534-doenitz-p1030681') ?? evalK.find(c => c.truth);
  const shorten = (state: string) =>
    state
      .split('\n')
      .map(l =>
        l
          .replace(/^(Candidate [A-D][^:]*: [A-Z]{0,90})[A-Z]*…?$/, '$1…')
          .replace(/^(Ciphertext \(\d+ letters\): [A-Z]{0,90})[A-Z]*…?$/, '$1…'),
      )
      .join('\n');
  const example = (id: string | undefined) => {
    if (!id) return null;
    const q = reqOf.get(id)!,
      a = responses.get(id)!;
    return {
      state: shorten(q.state),
      questions: q.questions,
      answers: a.answers.answers,
      usage: a.answers.usage,
      latencyMs: Math.round(a.latencyMs),
    };
  };
  const examples = {
    judge: exJ && { caseId: exJ.caseId, accuracy: exJ.cands.map(c => c.acc), ...example(exJ.id) },
    crib: exK && { caseId: exK.caseId, truth: exK.truth, ...example(exK.id) },
  };

  const experiments = existsSync(EXPERIMENTS) ? JSON.parse(readFileSync(EXPERIMENTS, 'utf8')) : null;
  const out = {
    generatedAt: new Date().toISOString(),
    log: LOG.replace(homedir(), '~'),
    model: 'jev-1.13.0',
    windows: {
      main: main && {
        file: main.file,
        start: new Date(main.start).toISOString(),
        end: new Date(main.end).toISOString(),
      },
      holdout: holdout && {
        file: holdout.file,
        start: new Date(holdout.start).toISOString(),
        end: new Date(holdout.end).toISOString(),
      },
      pilot: pilot && { start: new Date(pilot.start).toISOString(), end: new Date(pilot.end).toISOString() },
    },
    counts: {
      judge: judges.length,
      crib: cribs.length,
      unmatched,
      byPhase: Object.fromEntries(
        (['pilot', 'main', 'holdout', 'web'] as Phase[]).map(p => [
          p,
          { judge: judges.filter(j => j.phase === p).length, crib: cribs.filter(c => c.phase === p).length },
        ]),
      ),
    },
    candidateLevel,
    decisions,
    wrongAccepts,
    examples,
    choice,
    positions,
    ablation,
    cribSelection,
    latency,
    experiments,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  writeFileSync(
    DATASET,
    JSON.stringify({
      generatedAt: out.generatedAt,
      good: GOOD,
      jevAccept: JEV_ACCEPT,
      ngramAccept: ACCEPT,
      // One row per judged candidate in main + holdout. `text` is the message identity (the same synthetic text recurs across phases).
      rows: evalC.map(c => ({
        call: c.call,
        message: c.caseId,
        text: c.caseId.split(':')[1],
        kind: c.caseId.split(':')[1].startsWith('synthetic') ? 'synthetic' : 'historical',
        label: c.label,
        plaintext: c.text,
        cribStart: c.cribStart,
        cribLen: c.cribLen,
        y: c.y,
        acc: c.acc,
        jev: c.p,
        jevRecalibrated: pJevCal.get(c)!,
        germanness: c.g,
        ngramCalibrated: pNgram.get(c)!,
      })),
      calls: evalJ.map(j => ({
        call: j.id,
        message: `${j.phase}:${j.caseId}`,
        pick: j.pick,
        pickP: j.pickP,
        noneP: j.noneP,
        labels: j.cands.map(c => c.label),
      })),
      // The German training text the n-gram judge learned from, in its four operator conventions.
      lmTraining: trainingText(),
    }),
  );
  return out;
}

if (import.meta.main) {
  const r = analyse();
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '–');
  console.log(
    `judge calls ${r.counts.judge}, crib calls ${r.counts.crib}, unmatched ${r.counts.unmatched}`,
    JSON.stringify(r.counts.byPhase),
  );
  const c = r.candidateLevel;
  console.log(
    `eval candidates ${c.n} (${c.positives} correct) over ${c.calls} calls, ${c.messages} messages; base rate ${f(c.baseRate)}`,
  );
  console.log(
    `Jev    AUC ${f(c.jev.auc)} [${c.jev.aucCI.map(f)}]  Brier ${f(c.jev.brier)} [${c.jev.brierCI.map(f)}]  logloss ${f(c.jev.logLoss)}  ECE ${f(c.jev.ece)}`,
  );
  console.log(
    `n-gram AUC ${f(c.ngram.auc)} [${c.ngram.aucCI.map(f)}]  Brier ${f(c.ngram.brier)} [${c.ngram.brierCI.map(f)}]  logloss ${f(c.ngram.logLoss)}  ECE ${f(c.ngram.ece)}  raw AUC ${f(c.ngramRawAuc)}`,
  );
  console.log(
    `Jev recalibrated  Brier ${f(c.jevRecalibrated.brier)} [${c.jevRecalibrated.brierCI.map(f)}]  logloss ${f(c.jevRecalibrated.logLoss)}  ECE ${f(c.jevRecalibrated.ece)}`,
  );
  console.log(`constant Brier ${f(c.constant.brier)}`);
  for (const [k, v] of Object.entries(r.decisions))
    console.log(k.padEnd(36), JSON.stringify({ ...v.eval, accuracyCI: v.eval.accuracyCI.map(f) }));
  console.log('choice', JSON.stringify(r.choice), 'positions', JSON.stringify(r.positions));
  console.log('ablation', JSON.stringify(r.ablation, null, 0));
  const k = r.cribSelection;
  console.log(
    'cribs',
    JSON.stringify({ ...k, rows: undefined }),
    '\n',
    k.rows
      .map(x => `${x.caseId}:${x.truth} jev#${x.jevRank} static#${x.staticRank} p=${x.pTrue.toFixed(2)} top=${x.top}`)
      .join('\n '),
  );
  console.log(
    'latency',
    JSON.stringify(Object.fromEntries(Object.entries(r.latency).map(([t, v]) => [t, { ...v, ms: undefined }]))),
  );
}
