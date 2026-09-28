import { esc } from '../shared/dom.js';
import { initReader } from '../shared/reader.js';
import { initLabs } from './labs/index.js';

/**
 * Enigma × Jev, the research page. Reading aids (contents rail with the current
 * section highlighted, progress bar, heading anchors, citation previews) and
 * the evaluation figures, read live from the newest reports in reports/.
 */
const $ = (id: string) => document.getElementById(id) as HTMLElement;

initReader();
initLabs();

// ─────────────────────────── evaluation, live ───────────────────────────
type TierSummary = {
  cases: number;
  broken: number;
  jevRight: number;
  jevArgmaxRight: number;
  jevJudged: number;
  ngramRight: number;
  brier: number | null;
  medianMs: number;
};
type Summary = {
  byTier: Record<string, TierSummary>;
  crib: { withTrueCrib: number; jevMeanRank: number | null; staticMeanRank: number | null };
};
type BacktestReport = {
  file: string;
  meta: { seconds: number; jevCalls: number; seed: number; jev: string };
  summaries: Record<string, Summary>;
} | null;

const TIER_LABEL: Record<string, string> = {
  verify: 'verify · full key',
  key: 'key · daily key known',
  crib: 'crib · 14 known letters',
  bombe: 'bombe · Jev-ranked cribs',
  climb: 'climb · ciphertext only',
};

/** A rate as text beside a thin bar (one series per column, so no legend; the header names it). */
function rate(a: number, b: number, kind: 'brass' | 'jev' | 'mute'): string {
  if (!b) return '<span class="rate empty">–</span>';
  return `<span class="rate ${kind}" title="${a} of ${b} (${Math.round((100 * a) / b)}%)"><span class="track"><i style="width:${(100 * a) / b}%"></i></span><span class="v">${a}/${b}</span></span>`;
}

function resultsTable(title: string, s: Summary, n: number, caption: string): string {
  const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  const rows = Object.entries(s.byTier)
    .map(
      ([tier, t]) => `<tr><th scope="row">${TIER_LABEL[tier] ?? tier}</th>
    <td>${rate(t.broken, t.cases, 'brass')}</td>
    <td>${rate(t.jevRight, t.jevJudged, 'jev')}</td>
    <td>${rate(t.jevArgmaxRight, t.jevJudged, 'mute')}</td>
    <td>${tier === 'verify' ? '<span class="rate empty">–</span>' : rate(t.ngramRight, t.cases, 'mute')}</td>
    <td class="fig">${t.brier === null ? '–' : t.brier.toFixed(3)}</td>
    <td class="fig">${secs(t.medianMs)}</td></tr>`,
    )
    .join('');
  const c = s.crib;
  return (
    `<div class="tablewrap"><table class="atable results-t"><caption>${caption} <b>${esc(title)}, n = ${n}.</b></caption>
    <thead><tr><th>tier</th><th>broken</th><th>Jev rule right</th><th>Jev argmax right</th><th>n-gram right</th><th class="fig">Jev Brier</th><th class="fig">median time</th></tr></thead>
    <tbody>${rows}</tbody></table></div>` +
    (c.withTrueCrib
      ? `<p class="fine">Crib ranking: ${c.withTrueCrib} message(s) open with a listed crib; the true crib's mean rank was ${c.jevMeanRank?.toFixed(2) ?? '–'} in Jev's order against ${c.staticMeanRank?.toFixed(2) ?? '–'} in the static list (lower is better).</p>`
      : '')
  );
}

function setTile(k: string, a: number, b: number) {
  const tile = document.querySelector(`.tile[data-k="${k}"] .big`);
  if (tile && b) tile.innerHTML = `${a}<span class="of">/${b}</span>`;
}

async function loadResults() {
  const host = $('annexResults');
  try {
    const { main, holdout } = (await fetch('/api/report').then(r => r.json())) as {
      main: BacktestReport;
      holdout: BacktestReport;
    };
    if (!main) {
      host.innerHTML = '<p class="fine">No backtest report yet. Run <code>bun run backtest all</code>.</p>';
      return;
    }
    const sum = (sums: Summary[], tier: string, f: (t: TierSummary) => number) =>
      sums.reduce((n, s) => n + (s.byTier[tier] ? f(s.byTier[tier]) : 0), 0);
    const mains = Object.values(main.summaries);
    setTile(
      'key',
      sum(mains, 'key', t => t.broken),
      sum(mains, 'key', t => t.cases),
    );
    setTile(
      'crib',
      sum(mains, 'crib', t => t.broken),
      sum(mains, 'crib', t => t.cases),
    );
    setTile(
      'climb',
      sum(mains, 'climb', t => t.broken),
      sum(mains, 'climb', t => t.cases),
    );
    const all = [...mains, ...(holdout ? Object.values(holdout.summaries) : [])];
    const judged = ['key', 'crib', 'bombe', 'climb'];
    setTile(
      'jev',
      judged.reduce((n, t) => n + sum(all, t, x => x.jevRight), 0),
      judged.reduce((n, t) => n + sum(all, t, x => x.jevJudged), 0),
    );

    let html =
      '<div class="legend-note"><span class="rate brass"><span class="track"><i style="width:70%"></i></span></span> messages broken <span class="rate jev"><span class="track"><i style="width:70%"></i></span></span> Jev under the decision rule <span class="rate mute"><span class="track"><i style="width:70%"></i></span></span> baselines</div>';
    let k = 1;
    for (const [kind, s] of Object.entries(main.summaries)) {
      const n = Object.values(s.byTier)[0]?.cases ?? 0;
      html += resultsTable(
        kind === 'historical' ? 'Historical intercepts' : 'Synthetic, seed 1941',
        s,
        n,
        `Table C${k++}. Main run (${esc(main.file)}; ${main.meta.jev}; ${main.meta.jevCalls} Jev calls; ${Math.round(main.meta.seconds / 60)} min).`,
      );
    }
    if (holdout?.summaries.synthetic) {
      const s = holdout.summaries.synthetic;
      html += resultsTable(
        `Synthetic holdout, seed ${holdout.meta.seed}`,
        s,
        Object.values(s.byTier)[0]?.cases ?? 0,
        `Table C${k++}. Holdout run: new random keys, same plaintexts (${esc(holdout.file)}).`,
      );
    } else
      html += '<p class="fine">The holdout run (synthetic, seed 2024) appears here when its report is written.</p>';
    html +=
      '<p class="fine">“Jev rule right” applies the decision rule of B.6; “Jev argmax right” scores Jev\'s raw top choice alone. Brier: lower is better. Read live from <code>reports/</code>.</p>';
    host.innerHTML = html;
  } catch (err) {
    host.innerHTML = `<p class="fine">Could not load the backtest report: ${esc(String(err))}</p>`;
  }
}
loadResults();

// ─────────────────────────── the stop-count validation (Table B1) ───────────────────────────
type Stat = { n: number; mean: number; ci95: number };
type StopsReport = {
  generatedAt: string;
  seconds: number;
  singleLoop: { length: number; ours: Stat; weinbaum: { mean: number; ci95: number } }[];
  twoLoops: {
    lengths: number[];
    ours: Stat;
    weinbaum: { mean: number; ci95: number };
    turing: number;
    withDiagonalBoard: Stat;
  }[];
  female: { model: number; measured: number; min: number; max: number; orders: number; sheetsFor1Hole: number };
};
async function loadStops() {
  const host = document.getElementById('stopsVal');
  if (!host) return;
  try {
    const r = await fetch('/api/bombe-stops');
    if (!r.ok) {
      host.innerHTML =
        '<p class="fine">No validation report yet. Run <code>bun run src/analysis/bombe-stops.ts</code>.</p>';
      return;
    }
    const d = (await r.json()) as StopsReport;
    const n = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 1 });
    const within = (a: Stat, b: { mean: number; ci95: number }) =>
      Math.abs(a.mean - b.mean) <= 1.96 * Math.hypot(a.ci95 / 1.96, b.ci95 / 1.96) + 0.5;
    const cell = (a: Stat, b: { mean: number; ci95: number }) =>
      `<td class="fig">${n(a.mean)} ± ${n(a.ci95)}</td><td class="fig">${n(b.mean)} ± ${n(b.ci95)}</td><td>${within(a, b) ? '<span class="ok">agrees</span>' : '<span class="no">differs</span>'}</td>`;
    const rows = [
      ...d.singleLoop.map(
        s =>
          `<tr><th scope="row">one loop of ${s.length}${s.length % 2 ? '' : ' (even)'}</th>${cell(s.ours, s.weinbaum)}<td class="fig">17,576</td><td class="fig">–</td></tr>`,
      ),
      ...d.twoLoops.map(
        t =>
          `<tr><th scope="row">two loops, ${t.lengths.join(' + ')}</th>${cell(t.ours, t.weinbaum)}<td class="fig">${n(t.turing)}</td><td class="fig">${n(t.withDiagonalBoard.mean)}</td></tr>`,
      ),
    ].join('');
    const f = d.female;
    host.innerHTML = `<div class="tablewrap"><table class="atable"><caption>Table B1. Mean stops over 17,576 positions without the diagonal board, this register against Weinbaum (2025), with 95% intervals; Turing's estimate is 26<sup>4−c</sup> for c closures. The last column reruns the same menus with the diagonal board.</caption>
      <thead><tr><th>menu</th><th class="fig">this register</th><th class="fig">Weinbaum</th><th></th><th class="fig">Turing</th><th class="fig">with board</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="fine">Female-possible share of settings: <b>${f.measured.toFixed(4)}</b> measured over ${f.orders} wheel orders × 17,576 positions (range ${f.min.toFixed(3)}–${f.max.toFixed(3)}), against ${f.model.toFixed(4)} in Weinbaum's uniform model; sheets for one surviving hole among 676: ${f.sheetsFor1Hole.toFixed(1)}. Generated ${new Date(d.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} in ${d.seconds} s.</p>`;
  } catch (err) {
    host.innerHTML = `<p class="fine">Could not load the validation report: ${esc(String(err))}</p>`;
  }
}
loadStops();
