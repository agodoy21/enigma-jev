/**
 * Two controlled experiments on Jev, re-asking logged questions:
 *
 *   test–retest   the identical judge state and questions, asked again
 *   position      the same candidates in reversed order (A↔C), answers mapped back to content
 *   crib retest   the identical crib-ranking state, asked again
 *
 * Calls are drawn from the evaluation runs (main + holdout), stratified so half
 * contain a correct candidate. Results go to reports/jev-experiments.json and
 * the calls to their own log, so they never mix with the backtest record.
 *
 *   bun run src/analysis/jev-experiments.ts [--n 24] [--cribs 10]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_JEV_MODEL, JevClient, loadJevKey } from '../jev/client.js';
import { JEV_ACCEPT, judgeQuestions } from '../jev/judge.js';
import { analyse } from './jev-eval.js';

const ROOT = join(import.meta.dir, '..', '..');
const HOME = process.env.ENIGMA_JEV_HOME ?? join(homedir(), '.enigma-jev');
const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};

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
function pearson(a: number[], b: number[]) {
  const ma = mean(a),
    mb = mean(b);
  let n = 0,
    da = 0,
    db = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i] - mb);
    da += (x - ma) ** 2;
    db += (b[i] - mb) ** 2;
  });
  return n / Math.sqrt(da * db);
}
function spearman(a: number[], b: number[]) {
  const rank = (xs: number[]) => {
    const o = xs.map((x, i) => [x, i]).sort((p, q) => q[0] - p[0]);
    const r = new Array(xs.length);
    o.forEach(([, i], k) => {
      r[i] = k + 1;
    });
    return r;
  };
  return pearson(rank(a), rank(b));
}

const key = loadJevKey();
if (!key) {
  console.error('No TYPESAFE_API_KEY.');
  process.exit(1);
}
const jev = new JevClient({ apiKey: key, logPath: join(HOME, 'jev-experiments.jsonl') });

const log = readFileSync(join(HOME, 'jev-calls.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map(l => JSON.parse(l));
const reqById = new Map(log.filter(l => l.kind === 'request').map(l => [l.requestId, l]));
const resById = new Map(log.filter(l => l.kind === 'response').map(l => [l.requestId, l]));

// The evaluation runs' judge calls, located by the same run windows the analysis uses.
const analysis = analyse();
const evalIds: string[] = [];
{
  const lines = log.filter(l => l.kind === 'request' && l.questions.pick);
  const { main, holdout } = analysis.windows;
  const inWin = (at: string, w: { start: string; end: string } | undefined) =>
    !!w && Date.parse(at) >= Date.parse(w.start) && Date.parse(at) <= Date.parse(w.end);
  for (const l of lines) if (inWin(l.at, main) || inWin(l.at, holdout)) evalIds.push(l.requestId);
}

type Parsed = { head: string[]; cands: Array<{ note: string; text: string }> };
function parse(state: string): Parsed {
  const head: string[] = [],
    cands: Parsed['cands'] = [];
  for (const line of state.split('\n')) {
    const m = /^Candidate [A-D]( \([^)]*\))?: (.*)$/.exec(line);
    if (m) cands.push({ note: m[1] ?? '', text: m[2] });
    else head.push(line);
  }
  return { head, cands };
}
const build = (p: Parsed, order: number[]) =>
  [...p.head, ...order.map((k, i) => `Candidate ${'ABCD'[i]}${p.cands[k].note}: ${p.cands[k].text}`)].join('\n');
const L = ['A', 'B', 'C', 'D'];
/** The loose shape of a logged judge answer: one choice question and one probability per candidate. */
type LoggedAnswers = Record<string, { choice?: string; probabilities?: Record<string, number>; noul?: number }>;
interface Reading {
  pick: number;
  pickP: number;
  readable: number[];
  accepted: number;
}
const verdictOf = (a: LoggedAnswers, n: number): Reading => {
  const pick = a.pick.choice ?? 'none',
    pickP = a.pick.probabilities?.[pick] ?? 0;
  const readable = Array.from({ length: n }, (_, k) => a[`readable_${L[k]}`].noul ?? 0);
  const k = pick === 'none' ? -1 : L.indexOf(pick);
  return { pick: k, pickP, readable, accepted: k >= 0 && pickP >= JEV_ACCEPT && readable[k] >= JEV_ACCEPT ? k : -1 };
};

// Stratified sample: half the calls Jev originally accepted a candidate in, half it accepted none.
const r = rng(42);
const shuffle = <T>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const calls = evalIds
  .map(id => ({ id, req: reqById.get(id)!, res: resById.get(id)! }))
  .filter(c => c.res && parse(c.req.state).cands.length === 3);
const orig = (c: (typeof calls)[number]) => verdictOf(c.res.answers.answers, 3);
const pos = shuffle(calls.filter(c => orig(c).accepted >= 0)),
  neg = shuffle(calls.filter(c => orig(c).accepted < 0));
const n = arg('n', 24);
const sample = [...pos.slice(0, n / 2), ...neg.slice(0, n / 2)];

interface Pair {
  id: string;
  original: Reading;
}
const retest: Array<Pair & { again: Reading }> = [],
  position: Array<Pair & { reversed: Reading & { slotPicked: number } }> = [];
for (const c of sample) {
  const p = parse(c.req.state),
    q = judgeQuestions(3),
    o = orig(c);
  const again = verdictOf((await jev.evaluate(c.req.state, q)).answers.answers, 3);
  retest.push({ id: c.id, original: o, again });
  // Reverse the order: new slot i holds original candidate order[i].
  const order = [2, 1, 0];
  const rev = verdictOf((await jev.evaluate(build(p, order), q)).answers.answers, 3);
  const back = (k: number) => (k < 0 ? -1 : order[k]);
  position.push({
    id: c.id,
    original: o,
    reversed: {
      pick: back(rev.pick),
      accepted: back(rev.accepted),
      readable: order.map((_, k) => rev.readable[order.indexOf(k)]),
      pickP: rev.pickP,
      slotPicked: rev.pick,
    },
  });
  process.stdout.write('.');
}

// Crib ranking retest.
const cribCalls = shuffle(
  log.filter(
    l =>
      l.kind === 'request' &&
      l.questions.crib &&
      resById.has(l.requestId) &&
      Object.keys(l.questions.crib.criteria).length >= 6,
  ),
).slice(0, arg('cribs', 10));
const cribRetest: Array<{ id: string; options: number; p0: number[]; p1: number[]; top0?: string; top1?: string }> = [];
for (const c of cribCalls) {
  const a0 = resById.get(c.requestId)!.answers.answers.crib,
    a1 = (await jev.evaluate(c.state, c.questions)).answers.answers.crib as LoggedAnswers[string];
  const keys = Object.keys(c.questions.crib.criteria);
  cribRetest.push({
    id: c.requestId,
    options: keys.length,
    p0: keys.map(k => a0.probabilities[k] ?? 0),
    p1: keys.map(k => a1.probabilities?.[k] ?? 0),
    top0: a0.choice,
    top1: a1.choice,
  });
  process.stdout.write('c');
}
console.log();

const flatPairs = <R extends Record<K, Reading>, K extends string>(rows: R[], a: K, b: K) =>
  rows.flatMap(x => x[a].readable.map((v, k) => [v, x[b].readable[k]]));
const rt = flatPairs(retest, 'original', 'again'),
  ps = flatPairs(position, 'original', 'reversed');
const out = {
  generatedAt: new Date().toISOString(),
  model: DEFAULT_JEV_MODEL,
  calls: jev.calls,
  tokens: { input: jev.inputTokens, output: jev.outputTokens },
  sample: { n: sample.length, positives: Math.min(pos.length, n / 2), negatives: Math.min(neg.length, n / 2) },
  retest: {
    pickAgreement: mean(retest.map(x => (x.original.pick === x.again.pick ? 1 : 0))),
    decisionAgreement: mean(retest.map(x => (x.original.accepted === x.again.accepted ? 1 : 0))),
    meanAbsDelta: mean(rt.map(([a, b]) => Math.abs(a - b))),
    maxAbsDelta: Math.max(...rt.map(([a, b]) => Math.abs(a - b))),
    pearson: pearson(
      rt.map(x => x[0]),
      rt.map(x => x[1]),
    ),
    pairs: rt,
  },
  position: {
    pickAgreement: mean(position.map(x => (x.original.pick === x.reversed.pick ? 1 : 0))),
    decisionAgreement: mean(position.map(x => (x.original.accepted === x.reversed.accepted ? 1 : 0))),
    meanAbsDelta: mean(ps.map(([a, b]) => Math.abs(a - b))),
    maxAbsDelta: Math.max(...ps.map(([a, b]) => Math.abs(a - b))),
    pearson: pearson(
      ps.map(x => x[0]),
      ps.map(x => x[1]),
    ),
    pairs: ps,
    // Where the reversed prompt's pick landed, by slot; content-following picks move with the content.
    reversedSlots: ['A', 'B', 'C', 'none'].map(
      (_s, i) => position.filter(x => (i === 3 ? x.reversed.slotPicked < 0 : x.reversed.slotPicked === i)).length,
    ),
    originalSlots: ['A', 'B', 'C', 'none'].map(
      (_s, i) => position.filter(x => (i === 3 ? x.original.pick < 0 : x.original.pick === i)).length,
    ),
  },
  cribRetest: {
    n: cribRetest.length,
    topAgreement: mean(cribRetest.map(x => (x.top0 === x.top1 ? 1 : 0))),
    spearman: mean(cribRetest.map(x => spearman(x.p0, x.p1))),
    meanAbsDelta: mean(cribRetest.flatMap(x => x.p0.map((v: number, k: number) => Math.abs(v - x.p1[k])))),
  },
};
writeFileSync(join(ROOT, 'reports', 'jev-experiments.json'), JSON.stringify(out, null, 1));
console.log(
  JSON.stringify(
    { ...out, retest: { ...out.retest, pairs: undefined }, position: { ...out.position, pairs: undefined } },
    null,
    1,
  ),
);
