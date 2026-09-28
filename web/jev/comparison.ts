/** §4.8: Jev against the standard judges (analysis/judges.py): Tables 4–5 and Figure 9. */
import { $, type A, axisX, axisY, esc, legend, lin, S, table } from './kit.js';

// ─────────────────────────── §4.8 against the state of the art ───────────────────────────
const TRAINED_NOTE: Record<string, string> = {
  'Jev, zero-shot': 'none',
  'Index of coincidence': 'Platt, 1 feature',
  'Trigram German-ness': 'Platt, 1 feature',
  'Quadgram fitness': 'Platt, 1 feature',
  'Kneser-Ney 5-gram': 'Platt, 1 feature',
  'Logistic regression': '12 features',
  XGBoost: '12 features, 300 trees',
  'Jev, recalibrated': 'Platt, 1 feature',
};
export function judgesTable(d: A) {
  const js = d.cmp.judges as A[];
  const best = (k: string, lower: boolean) => (lower ? Math.min : Math.max)(...js.map(j => j[k]));
  const b = (v: number, k: string, lower: boolean, digits: number) => {
    const t = v.toFixed(digits);
    return v === best(k, lower) ? `<b>${t}</b>` : t;
  };
  const rows = js.map(j => [
    `${esc(j.name)}${j.name.startsWith('Jev') ? ' <span class="tagj">Jev</span>' : ''}`,
    TRAINED_NOTE[j.name] ?? '',
    `${b(j.auc, 'auc', false, 4)}<small> [${j.aucCI[0].toFixed(3)}–${j.aucCI[1].toFixed(3)}]</small>`,
    `${b(j.brier, 'brier', true, 4)}<small> [${j.brierCI[0].toFixed(3)}–${j.brierCI[1].toFixed(3)}]</small>`,
    j.logLoss.toFixed(3),
    j.ece.toFixed(3),
    `${(j.decisions.accuracy * 100).toFixed(1)}%`,
    `${j.decisions.acceptWrong} / ${j.decisions.rejectMissed}`,
  ]);
  const r = d.cmp.jevDecisionRule;
  rows.push([
    'Jev, its own decision rule <span class="tagj">Jev</span>',
    'none',
    '–',
    '–',
    '–',
    '–',
    `<b>${(r.accuracy * 100).toFixed(1)}%</b>`,
    `${r.acceptWrong} / ${r.rejectMissed}`,
  ]);
  $('tJudges').innerHTML = table(
    [
      'judge',
      'labels used',
      'AUC [95% CI]',
      'Brier [95% CI]',
      'log loss',
      'ECE',
      'decisions right',
      'wrong accepts / missed',
    ],
    rows,
    2,
  );
}
export function shiftTable(d: A) {
  const rows = (d.cmp.shift as A[]).map(j => [
    esc(j.name),
    j.auc.toFixed(3),
    j.brier.toFixed(4),
    `${(j.decisions.accuracy * 100).toFixed(1)}%`,
    `${j.decisions.acceptWrong} / ${j.decisions.rejectMissed}`,
  ]);
  const r = d.cmp.shiftMeta.jevRule;
  rows.push([
    'Jev, its own decision rule',
    '–',
    '–',
    `<b>${(r.accuracy * 100).toFixed(1)}%</b>`,
    `${r.acceptWrong} / ${r.rejectMissed}`,
  ]);
  $('tShift').innerHTML = table(
    ['judge (trained on synthetic traffic only)', 'AUC', 'Brier', 'decisions right', 'wrong accepts / missed'],
    rows,
  );
}
/** Figure 9: Brier score against the number of labelled texts a judge is given (log scale). */
export function curveChart(d: A) {
  const all = d.cmp.learningCurve as A[];
  // With 24 of 25 texts for training, a single held-out text decides the score: plotted to 20, tabled in full.
  const curve = all.filter(c => (c.texts as number) <= 20);
  const series = [
    { key: 'Jev, recalibrated|brier', label: 'Jev, recalibrated', color: S.jev },
    { key: 'Kneser-Ney 5-gram|brier', label: 'Kneser-Ney 5-gram', color: S.ngram },
    { key: 'XGBoost|brier', label: 'XGBoost', color: S.base },
    { key: 'Logistic regression|brier', label: 'Logistic regression', color: 'var(--s-4)' },
  ];
  const W = 760,
    H = 340,
    l = 64,
    r = 150,
    t = 16,
    h = 260;
  const ks = curve.map(c => c.texts as number);
  const x = (k: number) => l + (Math.log(k) / Math.log(ks.at(-1)!)) * (W - l - r);
  const ymax = 0.09,
    y = lin(0, ymax, t + h, t);
  let s = legend([
    ...series.map(se => ({ label: se.label, color: se.color })),
    { label: 'Jev, zero-shot (no labels)', color: S.jev, dash: true },
  ]);
  s += `<svg viewBox="0 0 ${W} ${H}" class="svgchart" role="img" aria-label="Brier score against the number of labelled texts, for each judge">`;
  s +=
    axisX(x, t + h, ks, 'labelled texts given to the judge (log scale)') +
    axisY(y, l, [0, 0.02, 0.04, 0.06, 0.08], 'Brier score (lower is better)', W - r, v => v.toFixed(2));
  const zero = curve.map(c => c['Jev, zero-shot|brier'].mean as number),
    z = zero.reduce((a, b) => a + b, 0) / zero.length;
  s += `<line x1="${x(ks[0])}" x2="${x(ks.at(-1)!)}" y1="${y(z)}" y2="${y(z)}" stroke="${S.jev}" stroke-width="2" stroke-dasharray="5 4"/>`;
  s += `<text class="note" x="${x(ks.at(-1)!) + 8}" y="${y(z) + 4}">Jev, zero-shot</text>`;
  for (const se of series) {
    const pts = curve
      .map(
        c =>
          [
            c.texts as number,
            c[se.key]?.mean as number,
            c[se.key]?.sd as number,
            c.labelledCandidates as number,
          ] as const,
      )
      .filter(p => Number.isFinite(p[1]));
    s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(Math.min(ymax, p[1])).toFixed(1)}`).join('')}" fill="none" stroke="${se.color}" stroke-width="2"/>`;
    for (const p of pts)
      s += `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(Math.min(ymax, p[1])).toFixed(1)}" r="4" fill="${se.color}" stroke="var(--card)" stroke-width="2"/><circle cx="${x(p[0]).toFixed(1)}" cy="${y(Math.min(ymax, p[1])).toFixed(1)}" r="10" fill="transparent" data-tip="${esc(se.label)} · ${p[0]} labelled text${p[0] === 1 ? '' : 's'} (~${Math.round(p[3])} candidates) · Brier ${p[1].toFixed(4)} ± ${p[2].toFixed(4)}"/>`;
  }
  $('chCurve').innerHTML = s + '</svg>';
  $('tCurve').innerHTML = table(
    [
      'labelled texts',
      '≈ candidates',
      'XGBoost',
      'logistic',
      'Kneser-Ney 5-gram',
      'Jev, recalibrated',
      'Jev, zero-shot',
    ],
    all.map(c => [
      c.texts,
      Math.round(c.labelledCandidates),
      ...['XGBoost', 'Logistic regression', 'Kneser-Ney 5-gram', 'Jev, recalibrated', 'Jev, zero-shot'].map(k =>
        (c[`${k}|brier`]?.mean ?? NaN).toFixed(4),
      ),
    ]),
  );
}
