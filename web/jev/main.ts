/**
 * Enigma × Jev, the Jev performance paper. Every number in the text is bound
 * to reports/jev-analysis.json (built by src/analysis/jev-eval.ts), so the
 * prose, tables and figures cannot drift from the data.
 *
 * Figures are plain SVG. Colour follows the judge, never the rank: Jev blue,
 * n-gram orange, "no judge" aqua (the first three validated categorical slots,
 * both themes). Every multi-series figure has a legend and direct labels;
 * every mark has a hover tooltip.
 */
import { initReader } from '../shared/reader.js';
import { curveChart, judgesTable, shiftTable } from './comparison.js';
import { cribChart, decChart, example, latChart, relChart, retestChart, rocChart, strips, tables } from './figures.js';
import { type A, bind } from './kit.js';

// ─────────────────────────── boot ───────────────────────────
(async () => {
  const res = await fetch('/api/jev-analysis');
  if (!res.ok) {
    document
      .querySelector('.abstract')!
      .insertAdjacentHTML(
        'afterend',
        '<p class="fine">No analysis yet: run <code>bun run src/analysis/jev-eval.ts</code>.</p>',
      );
    initReader('Research note');
    return;
  }
  const d = await res.json();
  // The conclusion's outcome table reads the newest backtest report.
  d.report = await fetch('/api/report')
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
  // §4.8: the same candidates, judged by the standard alternatives (analysis/judges.py).
  const cmp = await fetch('/api/judge-comparison')
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
  if (cmp) {
    d.cmp = cmp;
    d.judge = Object.fromEntries(cmp.judges.map((j: A) => [j.name, j]));
    d.shiftBy = Object.fromEntries(cmp.shift.map((j: A) => [j.name, j]));
    d.lc = Object.fromEntries(
      cmp.learningCurve.map((r: A) => [
        String(r.texts),
        {
          labelled: r.labelledCandidates,
          xgb: r['XGBoost|brier']?.mean,
          lr: r['Logistic regression|brier']?.mean,
          kn: r['Kneser-Ney 5-gram|brier']?.mean,
          jevcal: r['Jev, recalibrated|brier']?.mean,
          jev: r['Jev, zero-shot|brier']?.mean,
          xgbAuc: r['XGBoost|auc']?.mean,
        },
      ]),
    );
  }
  bind(d);
  if (cmp) {
    judgesTable(d);
    shiftTable(d);
    curveChart(d);
  }
  const chk = document.getElementById('chk100');
  if (chk && d.latency?.judge?.p50) chk.textContent = `${((100 * d.latency.judge.p50) / 1000).toFixed(0)} seconds`;
  tables(d);
  example(d);
  strips(d);
  rocChart(d);
  relChart(d);
  decChart(d);
  cribChart(d);
  retestChart(d);
  latChart(d);
  initReader('Research note');
})();
