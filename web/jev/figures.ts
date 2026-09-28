/** The Jev paper's figures (1–8), tables and the verbatim example call. */
import { $, type A, axisX, axisY, esc, f3, jit, legend, lin, median, S, table } from './kit.js';

// ─────────────────────────── figures ───────────────────────────
export function strips(d: A) {
  const pts = d.candidateLevel.points as Array<{ p: number; g: number; y: number; acc: number }>;
  const W = 760,
    H = 250,
    pw = 330,
    gap = 60,
    left = 70,
    top = 34;
  const rowY = (y: number) => top + (y ? 50 : 140);
  const panel = (
    ox: number,
    key: 'p' | 'g',
    dom: [number, number],
    bar: number,
    color: string,
    title: string,
    barLabel: string,
  ) => {
    const x = lin(dom[0], dom[1], ox, ox + pw);
    let s = `<text class="ptitle" x="${ox}" y="${top - 16}">${title}</text>`;
    s += `<line class="axis" x1="${ox}" x2="${ox + pw}" y1="${top + 190}" y2="${top + 190}"/>`;
    s += axisX(
      x,
      top + 190,
      key === 'p' ? [0, 0.25, 0.5, 0.75, 1] : [-0.25, 0, 0.25, 0.5, 0.75, 1],
      key === 'p' ? 'Jev P(correct)' : 'German-ness (0 random, 1 German)',
      v => (key === 'p' ? v.toFixed(2) : v.toFixed(2)),
    );
    s += `<line class="bar" x1="${x(bar)}" x2="${x(bar)}" y1="${top + 10}" y2="${top + 186}"/><text class="note" x="${x(bar) + 4}" y="${top + 20}">${barLabel}</text>`;
    pts.forEach((pt, i) => {
      const v = Math.max(dom[0], Math.min(dom[1], pt[key]));
      s += `<circle class="dot" cx="${x(v).toFixed(1)}" cy="${(rowY(pt.y) + jit(i) * 26).toFixed(1)}" r="4" fill="${color}" data-tip="${pt.y ? 'Correct' : 'Wrong'} candidate · ${key === 'p' ? 'P(correct)' : 'German-ness'} ${pt[key].toFixed(2)} · matches ${Math.round(pt.acc * 100)}% of plaintext"/>`;
    });
    return s;
  };
  const counts = [pts.filter(p => p.y).length, pts.filter(p => !p.y).length];
  let s = `<svg viewBox="0 0 ${W} ${H + 20}" class="svgchart" role="img" aria-label="Strip plots of Jev P(correct) and n-gram German-ness for correct and wrong candidates">`;
  s += `<text class="rowl" x="${left - 12}" y="${rowY(1) + 4}" text-anchor="end">correct</text><text class="rowl sub" x="${left - 12}" y="${rowY(1) + 18}" text-anchor="end">n = ${counts[0]}</text>`;
  s += `<text class="rowl" x="${left - 12}" y="${rowY(0) + 4}" text-anchor="end">wrong</text><text class="rowl sub" x="${left - 12}" y="${rowY(0) + 18}" text-anchor="end">n = ${counts[1]}</text>`;
  s += panel(left, 'p', [0, 1], 0.5, S.jev, 'Jev', 'bar 0.5');
  s += panel(left + pw + gap, 'g', [-0.3, 1], 0.4, S.ngram, 'n-gram', 'bar 0.4');
  $('chStrips').innerHTML = s + '</svg>';
  const row = (label: string, xs: number[]) => [
    label,
    xs.length,
    f3(Math.min(...xs)),
    f3(median(xs)),
    f3(Math.max(...xs)),
  ];
  $('tStrips').innerHTML = table(
    ['group', 'n', 'min', 'median', 'max'],
    [
      row(
        'Jev P(correct), correct',
        pts.filter(p => p.y).map(p => p.p),
      ),
      row(
        'Jev P(correct), wrong',
        pts.filter(p => !p.y).map(p => p.p),
      ),
      row(
        'German-ness, correct',
        pts.filter(p => p.y).map(p => p.g),
      ),
      row(
        'German-ness, wrong',
        pts.filter(p => !p.y).map(p => p.g),
      ),
    ],
  );
}

export function rocChart(d: A) {
  const W = 400,
    H = 380,
    l = 56,
    t = 20,
    w = 300,
    h = 300;
  const x = lin(0, 1, l, l + w),
    y = lin(0, 1, t + h, t);
  const path = (pts: Array<[number, number]>) =>
    pts.map(([fx, ty], i) => `${i ? 'L' : 'M'}${x(fx).toFixed(1)},${y(ty).toFixed(1)}`).join('');
  const c = d.candidateLevel;
  let s = legend([
    { label: `Jev · AUC ${c.jev.auc.toFixed(4)}`, color: S.jev },
    { label: `n-gram, calibrated · AUC ${c.ngram.auc.toFixed(3)}`, color: S.ngram },
  ]);
  s += `<svg viewBox="0 0 ${W} ${H}" class="svgchart" role="img" aria-label="ROC curves for Jev and the n-gram judge">`;
  s +=
    axisX(x, t + h, [0, 0.25, 0.5, 0.75, 1], 'false-positive rate') +
    axisY(y, l, [0, 0.25, 0.5, 0.75, 1], 'true-positive rate', l + w);
  s += `<line class="diag" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/>`;
  s += `<path d="${path(c.roc.ngram)}" fill="none" stroke="${S.ngram}" stroke-width="2"/>`;
  s += `<path d="${path(c.roc.jev)}" fill="none" stroke="${S.jev}" stroke-width="2"/>`;
  for (const [name, pts, col] of [
    ['Jev', c.roc.jev, S.jev],
    ['n-gram', c.roc.ngram, S.ngram],
  ] as const) {
    (pts as Array<[number, number]>).forEach(([fx, ty], i) => {
      if (i % 3 === 0)
        s += `<circle cx="${x(fx)}" cy="${y(ty)}" r="7" fill="transparent" data-tip="${name}: FPR ${fx.toFixed(3)}, TPR ${ty.toFixed(3)}"/>`;
    });
    void col;
  }
  s += `<text class="dl" x="${x(0.03)}" y="${y(0.55)}" fill="${S.jev}">Jev</text><text class="dl" x="${x(0.17)}" y="${y(0.9)}" fill="${S.ngram}">n-gram</text>`;
  $('chRoc').innerHTML = s + '</svg>';
}

export function relChart(d: A) {
  const W = 420,
    H = 400,
    l = 56,
    t = 16,
    w = 320,
    h = 320;
  const x = lin(0, 1, l, l + w),
    y = lin(0, 1, t + h, t);
  const c = d.candidateLevel;
  const series = [
    { key: 'jev', label: 'Jev, raw', color: S.jev, dash: false, shape: 'circle' },
    { key: 'jevRecalibrated', label: 'Jev, recalibrated', color: S.jev, dash: true, shape: 'square' },
    { key: 'ngram', label: 'n-gram, calibrated', color: S.ngram, dash: false, shape: 'diamond' },
  ];
  let s = legend(
    series.map(se => ({ label: `${se.label} · ECE ${c[se.key].ece.toFixed(3)}`, color: se.color, dash: se.dash })),
  );
  s += `<svg viewBox="0 0 ${W} ${H}" class="svgchart" role="img" aria-label="Reliability diagram">`;
  s +=
    axisX(x, t + h, [0, 0.2, 0.4, 0.6, 0.8, 1], 'predicted P(correct), bin mean', v => v.toFixed(1)) +
    axisY(y, l, [0, 0.2, 0.4, 0.6, 0.8, 1], 'observed share correct', l + w, v => v.toFixed(1));
  s += `<line class="diag" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/><text class="note" x="${x(0.62)}" y="${y(0.7)}" transform="rotate(-45 ${x(0.62)} ${y(0.7)})">perfect calibration</text>`;
  const maxN = Math.max(...series.flatMap(se => c[se.key].bins.map((b: A) => b.n)));
  for (const se of series) {
    const bins = (c[se.key].bins as A[]).filter(b => b.n > 0);
    s += `<path d="${bins.map((b, i) => `${i ? 'L' : 'M'}${x(b.meanP).toFixed(1)},${y(b.rate).toFixed(1)}`).join('')}" fill="none" stroke="${se.color}" stroke-width="2" ${se.dash ? 'stroke-dasharray="5 4"' : ''} opacity=".85"/>`;
    for (const b of bins) {
      const r = 4 + 8 * Math.sqrt(b.n / maxN),
        cx = x(b.meanP),
        cy = y(b.rate);
      const tipText = `${se.label} · bin ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} · n = ${b.n} · mean P ${b.meanP.toFixed(2)} · observed ${b.rate.toFixed(2)}`;
      s +=
        se.shape === 'circle'
          ? `<circle class="mk" cx="${cx}" cy="${cy}" r="${r}" fill="${se.color}" data-tip="${tipText}"/>`
          : se.shape === 'square'
            ? `<rect class="mk" x="${cx - r * 0.85}" y="${cy - r * 0.85}" width="${r * 1.7}" height="${r * 1.7}" rx="2" fill="none" stroke="${se.color}" stroke-width="2" data-tip="${tipText}"/>`
            : `<path class="mk" d="M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z" fill="${se.color}" data-tip="${tipText}"/>`;
    }
  }
  s += `<text class="dl" x="${x(0.03)}" y="${y(0.93)}" fill="${S.jev}">raw Jev: right order,</text><text class="dl" x="${x(0.03)}" y="${y(0.87)}" fill="${S.jev}">too cautious at both ends</text>`;
  $('chRel').innerHTML = s + '</svg>';
  $('tRel').innerHTML = table(
    [
      'bin',
      'Jev n',
      'Jev mean P',
      'Jev observed',
      'recal. mean P',
      'recal. observed',
      'n-gram n',
      'n-gram mean P',
      'n-gram observed',
    ],
    c.jev.bins.map((b: A, i: number) => [
      `${b.lo.toFixed(1)}–${b.hi.toFixed(1)}`,
      b.n,
      b.n ? f3(b.meanP) : '–',
      b.n ? f3(b.rate) : '–',
      c.jevRecalibrated.bins[i].n ? f3(c.jevRecalibrated.bins[i].meanP) : '–',
      c.jevRecalibrated.bins[i].n ? f3(c.jevRecalibrated.bins[i].rate) : '–',
      c.ngram.bins[i].n,
      c.ngram.bins[i].n ? f3(c.ngram.bins[i].meanP) : '–',
      c.ngram.bins[i].n ? f3(c.ngram.bins[i].rate) : '–',
    ]),
  );
}

export function decChart(d: A) {
  const rules = Object.entries(d.decisions) as Array<[string, A]>;
  const colorOf = (name: string) => (name.startsWith('Jev') ? S.jev : name.startsWith('n-gram') ? S.ngram : S.base);
  const W = 760,
    rowH = 38,
    l = 270,
    r = 90,
    t = 10,
    H = t + rules.length * rowH + 44;
  const x = lin(0, 1, l, W - r);
  let s = legend([
    { label: 'Jev', color: S.jev },
    { label: 'n-gram statistic', color: S.ngram },
    { label: 'no judge', color: S.base },
  ]);
  s += `<svg viewBox="0 0 ${W} ${H}" class="svgchart" role="img" aria-label="Decision accuracy by rule with confidence intervals">`;
  s += [0, 0.25, 0.5, 0.75, 1]
    .map(v => `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${t}" y2="${t + rules.length * rowH}"/>`)
    .join('');
  s += axisX(
    x,
    t + rules.length * rowH,
    [0, 0.25, 0.5, 0.75, 1],
    'share of calls decided correctly (95% bootstrap interval)',
    v => `${Math.round(v * 100)}%`,
  );
  rules.forEach(([name, v], i) => {
    const cy = t + i * rowH + rowH / 2,
      e = v.eval,
      col = colorOf(name);
    s += `<text class="rowl" x="${l - 12}" y="${cy + 4}" text-anchor="end">${esc(name)}</text>`;
    s += `<line x1="${x(e.accuracyCI[0])}" x2="${x(e.accuracyCI[1])}" y1="${cy}" y2="${cy}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
    s += `<circle class="mk" cx="${x(e.accuracy)}" cy="${cy}" r="6" fill="${col}" data-tip="${esc(name)} · ${(e.accuracy * 100).toFixed(1)}% (${(e.accuracyCI[0] * 100).toFixed(1)}–${(e.accuracyCI[1] * 100).toFixed(1)}%) · accepted wrong ${e.acceptWrong} · missed correct ${e.rejectMissed}"/>`;
    s += `<text class="val" x="${W - r + 10}" y="${cy + 4}">${(e.accuracy * 100).toFixed(1)}%</text>`;
  });
  $('chDec').innerHTML = `<div class="scrollx">${s}</svg></div>`;
  $('tDec').innerHTML = table(
    [
      'rule',
      'accepted, correct',
      'accepted, wrong',
      'rejected, correct missed',
      'rejected, none correct',
      'precision',
      'recall',
      'accuracy',
    ],
    rules.map(([name, v]) => [
      esc(name),
      v.eval.acceptCorrect,
      v.eval.acceptWrong,
      v.eval.rejectMissed,
      v.eval.rejectRight,
      f3(v.eval.precision),
      f3(v.eval.recall),
      `${(v.eval.accuracy * 100).toFixed(1)}%`,
    ]),
  );
}

export function cribChart(d: A) {
  const rows = d.cribSelection.rows as A[];
  const maxR = Math.max(...rows.map(r => r.options));
  const W = 760,
    rowH = 30,
    l = 250,
    r = 30,
    t = 8,
    H = t + rows.length * rowH + 44;
  const x = lin(1, maxR, l, W - r);
  let s = legend([
    { label: "Jev's order (dot)", color: S.jev },
    { label: 'fixed list order (ring)', color: S.base },
  ]);
  s += `<svg viewBox="0 0 ${W} ${H}" class="svgchart" role="img" aria-label="Rank of the true crib per call">`;
  s += axisX(
    x,
    t + rows.length * rowH,
    Array.from({ length: maxR }, (_, i) => i + 1).filter(v => v === 1 || v % 2 === 1),
    'rank of the true crib (1 = tried first)',
  );
  rows.forEach((row, i) => {
    const cy = t + i * rowH + rowH / 2,
      name = `${row.caseId.replace(/-p1030681|-u264|-1941-part1/, '')} · ${row.truth}`;
    s += `<text class="rowl" x="${l - 12}" y="${cy + 4}" text-anchor="end">${esc(name)}${row.phase === 'holdout' ? ' (holdout)' : ''}</text>`;
    s += `<line class="track" x1="${x(1)}" x2="${x(row.options)}" y1="${cy}" y2="${cy}"/>`;
    s += `<line x1="${x(row.staticRank)}" x2="${x(row.jevRank)}" y1="${cy}" y2="${cy}" stroke="var(--muted)" stroke-width="1.5"/>`;
    s += `<circle class="ring" cx="${x(row.staticRank)}" cy="${cy}" r="7.5" fill="none" stroke="${S.base}" stroke-width="2.5" data-tip="${esc(row.truth)} · fixed list rank ${row.staticRank} of ${row.options}"/>`;
    s += `<circle class="mk" cx="${x(row.jevRank)}" cy="${cy}" r="4.5" fill="${S.jev}" data-tip="${esc(row.truth)} · Jev rank ${row.jevRank} of ${row.options} · P = ${row.pTrue.toFixed(2)} · Jev's top: ${esc(row.top)} (${row.pTop.toFixed(2)})"/>`;
  });
  $('chCrib').innerHTML =
    s +
    '</svg><p class="fine">A ring round a dot means Jev and the list agreed. Messages marked (holdout) reappear under new keys.</p>';
}

export function retestChart(d: A) {
  const e = d.experiments;
  if (!e) {
    $('chRetest').innerHTML =
      '<p class="fine">Run <code>bun run src/analysis/jev-experiments.ts</code> to produce this figure.</p>';
    return;
  }
  const W = 760,
    H = 346,
    pw = 280,
    l = 60,
    gap = 90,
    t = 44;
  const panel = (ox: number, pairs: Array<[number, number]>, title: string, stats: string, ylab: string) => {
    const x = lin(0, 1, ox, ox + pw),
      y = lin(0, 1, t + pw, t);
    let s = `<text class="ptitle" x="${ox}" y="${t - 26}">${title}</text><text class="note" x="${ox}" y="${t - 10}">${stats}</text>`;
    s +=
      axisX(x, t + pw, [0, 0.5, 1], 'first asking', v => v.toFixed(1)) +
      axisY(y, ox, [0, 0.5, 1], ylab, ox + pw, v => v.toFixed(1));
    s += `<line class="diag" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/>`;
    s += `<line class="bar" x1="${x(0.5)}" x2="${x(0.5)}" y1="${y(0)}" y2="${y(1)}"/><line class="bar" x1="${x(0)}" x2="${x(1)}" y1="${y(0.5)}" y2="${y(0.5)}"/>`;
    pairs.forEach(([a, b]) => {
      s += `<circle class="dot" cx="${x(a)}" cy="${y(b)}" r="4.5" fill="${S.jev}" data-tip="first ${a.toFixed(2)} · second ${b.toFixed(2)} · Δ ${(b - a).toFixed(2)}"/>`;
    });
    return s;
  };
  let s = `<svg viewBox="0 0 ${W} ${H + 30}" class="svgchart" role="img" aria-label="Test-retest and position experiments">`;
  s += panel(
    l,
    e.retest.pairs,
    'Same prompt, asked again',
    `r = ${e.retest.pearson.toFixed(3)} · decisions ${Math.round(e.retest.decisionAgreement * 100)}% same`,
    'second asking',
  );
  s += panel(
    l + pw + gap,
    e.position.pairs,
    'Candidates reversed',
    `r = ${e.position.pearson.toFixed(3)} · decisions ${Math.round(e.position.decisionAgreement * 100)}% same`,
    'reversed order',
  );
  $('chRetest').innerHTML = s + '</svg>';
}

export function latChart(d: A) {
  const types = [
    ['judge', 'judge calls'],
    ['crib', 'crib calls'],
  ] as const;
  const all = types.flatMap(([k]) => d.latency[k].ms as number[]);
  const W = 760,
    l = 110,
    r = 30,
    t = 10,
    rowH = 60,
    H = t + types.length * rowH + 44;
  const x = lin(0, Math.ceil(Math.max(...all) / 100) * 100, l, W - r);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="svgchart" role="img" aria-label="Latency of every Jev call">`;
  const max = Math.ceil(Math.max(...all) / 100) * 100;
  s += axisX(
    x,
    t + types.length * rowH,
    Array.from({ length: max / 200 + 1 }, (_, i) => i * 200),
    'latency (ms)',
  );
  types.forEach(([k, label], i) => {
    const cy = t + i * rowH + rowH / 2,
      ms = d.latency[k].ms as number[];
    s += `<text class="rowl" x="${l - 12}" y="${cy + 4}" text-anchor="end">${label}</text><text class="rowl sub" x="${l - 12}" y="${cy + 18}" text-anchor="end">n = ${ms.length}</text>`;
    ms.forEach((v, j) => {
      s += `<circle class="dot" cx="${x(v)}" cy="${cy + jit(j + i * 1000) * 16}" r="4" fill="${S.jev}" data-tip="${label.slice(0, -1)} · ${Math.round(v)} ms"/>`;
    });
    const m = d.latency[k].p50;
    s += `<line x1="${x(m)}" x2="${x(m)}" y1="${cy - 24}" y2="${cy + 24}" stroke="var(--ink)" stroke-width="2"/><text class="val" x="${x(m) + 6}" y="${cy - 16}">median ${Math.round(m)} ms</text>`;
  });
  $('chLat').innerHTML = s + '</svg>';
}

// ─────────────────────────── tables and the example call ───────────────────────────
export function tables(d: A) {
  const p = d.counts.byPhase;
  $('phaseTable').insertAdjacentHTML(
    'beforeend',
    `<thead><tr><th>phase</th><th>what it is</th><th class="fig">judge calls</th><th class="fig">crib calls</th></tr></thead><tbody>
    <tr><td>pilot</td><td>first backtest: judge state without crib marking; no decision rule</td><td class="fig">${p.pilot.judge}</td><td class="fig">${p.pilot.crib}</td></tr>
    <tr><td>main</td><td>9 historical + 16 synthetic messages (keys seed 1941)</td><td class="fig">${p.main.judge}</td><td class="fig">${p.main.crib}</td></tr>
    <tr><td>holdout</td><td>the 16 synthetic texts under new keys (seed 2024)</td><td class="fig">${p.holdout.judge}</td><td class="fig">${p.holdout.crib}</td></tr>
    <tr><td>web</td><td>page runs on historical intercepts (not in the evaluation)</td><td class="fig">${p.web.judge}</td><td class="fig">${p.web.crib}</td></tr></tbody>`,
  );
  const c = d.candidateLevel;
  const row = (name: string, m: A, color: string) =>
    `<tr><th scope="row"><span class="sw" style="background:${color}"></span>${name}</th><td class="fig">${f3(m.brier)}</td><td class="fig">${f3(m.logLoss)}</td><td class="fig">${m.ece !== undefined ? f3(m.ece) : '–'}</td><td class="fig">${m.murphy ? f3(m.murphy.reliability) : '–'}</td><td class="fig">${m.murphy ? f3(m.murphy.resolution) : '–'}</td><td class="fig">${m.murphy ? f3(m.murphy.uncertainty) : f3(c.baseRate * (1 - c.baseRate))}</td><td class="fig">${m.auc !== undefined ? m.auc.toFixed(4) : '–'}</td></tr>`;
  $('murphyTable').insertAdjacentHTML(
    'beforeend',
    `<thead><tr><th>judge</th><th class="fig">Brier</th><th class="fig">log loss</th><th class="fig">ECE</th><th class="fig">reliability</th><th class="fig">resolution</th><th class="fig">uncertainty</th><th class="fig">AUC</th></tr></thead><tbody>
    ${row('Jev, raw', c.jev, S.jev)}${row('Jev, recalibrated', c.jevRecalibrated, S.jev)}${row('n-gram, calibrated', c.ngram, S.ngram)}${row('constant (base rate)', c.constant, S.base)}</tbody>`,
  );
}

export function example(d: A) {
  const ex = d.examples?.judge;
  if (!ex) return;
  $('exState').textContent = ex.state;
  const q = ex.questions,
    pretty: string[] = [];
  for (const [k, v] of Object.entries(q) as Array<[string, A]>)
    pretty.push(
      `${k}: ${v.type}\n  ${v.instructions}${v.criteria ? `\n  options: ${Object.keys(v.criteria).join(', ')}` : ''}`,
    );
  $('exQuestions').textContent = pretty.join('\n');
  const a = ex.answers,
    out: string[] = [];
  for (const [k, v] of Object.entries(a) as Array<[string, A]>)
    out.push(
      v.type === 'choice'
        ? `${k}: ${v.choice}  ${Object.entries(v.probabilities)
            .map(([o, p]) => `${o} ${(p as number).toFixed(2)}`)
            .join(' · ')}`
        : `${k}: ${v.noul}`,
    );
  $('exAnswers').textContent = out.join('\n');
  $('exLatency').textContent = `${ex.latencyMs} ms, ${ex.usage.input_tokens} tokens in, ${ex.usage.output_tokens} out`;
  $('exCase').textContent =
    `${ex.caseId}; candidates match ${ex.accuracy.map((x: number) => `${Math.round(x * 100)}%`).join(', ')} of the plaintext`;
}
