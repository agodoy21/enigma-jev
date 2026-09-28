/** Figure 7: Turing's test register, run over every start position, with and without the diagonal board. */
import * as D from '../bombe-demo.js';
import { $, A, fmtInt, nextFrame } from './util.js';

function menuSvg(edges: readonly D.Edge[], test: number): string {
  const letters = [...new Set(edges.flatMap(e => [e.a, e.b]))].sort((a, b) => a - b);
  const n = letters.length,
    R = 118,
    cx = 150,
    cy = 142;
  const at = (x: number) => {
    const k = letters.indexOf(x),
      t = (2 * Math.PI * k) / n - Math.PI / 2;
    return [cx + R * Math.cos(t), cy + R * Math.sin(t)];
  };
  const groups = new Map<string, number[]>();
  edges.forEach((e, k) => {
    const key = [Math.min(e.a, e.b), Math.max(e.a, e.b)].join(',');
    groups.set(key, [...(groups.get(key) ?? []), k]);
  });
  let lines = '',
    labels = '';
  for (const ks of groups.values())
    ks.forEach((k, m) => {
      const e = edges[k],
        [x1, y1] = at(e.a),
        [x2, y2] = at(e.b);
      const off = (m - (ks.length - 1) / 2) * 26,
        dx = x2 - x1,
        dy = y2 - y1,
        len = Math.hypot(dx, dy) || 1;
      const mx = (x1 + x2) / 2 - (dy / len) * off,
        my = (y1 + y2) / 2 + (dx / len) * off;
      const loop = D.onLoop(edges, k);
      lines += `<path class="mn-e ${loop ? 'loop' : ''}" d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}"><title>position ${e.i + 1}: ${A[e.a]} ↔ ${A[e.b]}</title></path>`;
      const lx = (x1 + 2 * mx + x2) / 4,
        ly = (y1 + 2 * my + y2) / 4;
      labels += `<text class="mn-l ${loop ? 'loop' : ''}" x="${lx}" y="${ly + 3}" text-anchor="middle">${e.i + 1}</text>`;
    });
  const nodes = letters
    .map(x => {
      const [px, py] = at(x);
      return `<circle class="mn-n ${x === test ? 'test' : ''}" cx="${px}" cy="${py}" r="12"/><text class="mn-t" x="${px}" y="${py + 4.5}" text-anchor="middle">${A[x]}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 300 284" class="mn" role="img" aria-label="Bombe menu: letters joined by the message positions that pair them; loops in brass">${lines}${labels}${nodes}</svg>`;
}

export function bombeLab(host: HTMLElement) {
  host.innerHTML = `<div class="bl">
    <div class="bl-l"><div id="blMenu"></div><p class="fine bl-cap" id="blMenuCap"></p></div>
    <div class="bl-r">
      <div class="lab-controls">
        <label class="lab-range">crib <input type="range" id="blLen" min="12" max="${D.CRIB.length}" value="${D.CRIB.length}"><output id="blLenV"></output></label>
        <label class="lab-check"><input type="checkbox" id="blDiag" checked> diagonal board</label>
      </div>
      <div class="bl-drums"><span class="bl-lbl">drums</span><span class="bl-drum" id="blD0">A</span><span class="bl-drum" id="blD1">A</span><span class="bl-drum" id="blD2">A</span><span class="bl-pos fine" id="blPos"></span></div>
      <div class="bl-reg" id="blReg" aria-label="test register"></div>
      <p class="lab-read" id="blRead" aria-live="polite"></p>
      <div class="lab-controls"><button type="button" class="lab-btn primary" id="blRun">Run the Bombe</button><button type="button" class="lab-btn quiet" id="blReset">Reset</button></div>
      <div class="bl-stats" id="blStats"></div>
    </div></div>`;
  const len = $('blLen') as HTMLInputElement,
    diag = $('blDiag') as HTMLInputElement,
    run = $('blRun') as HTMLButtonElement;
  let edges: D.Edge[] = [],
    test = 0,
    hyp = 0,
    bombe: D.DemoBombe,
    cursor = 0,
    stops = 0,
    running = false,
    token = 0,
    closures = 0,
    evenLoop = false;
  const trueStart = D.posIndex(D.DEMO_KEY.positions);
  const partner = (x: number) => {
    const pair = D.DEMO_KEY.plugboard.split(' ').find(p => p.includes(A[x]));
    return pair ? A.indexOf(pair[0] === A[x] ? pair[1] : pair[0]) : x;
  };

  const showReg = (reg: ArrayLike<number>) => {
    $('blReg')!.innerHTML =
      `<span class="bl-lbl">register ${A[test]}</span>` +
      [...A]
        .map(
          (ch, k) =>
            `<span class="${reg[k] ? 'live' : ''} ${k === hyp ? 'hyp' : ''}" title="${A[test]} plugged to ${ch}${reg[k] ? ': live' : ''}">${ch}</span>`,
        )
        .join('');
  };
  const showDrums = (pos: number) => {
    const s = D.posLetters(pos);
    [0, 1, 2].forEach(i => {
      $(`blD${i}`)!.textContent = s[i];
    });
    $('blPos')!.textContent = `${fmtInt(pos)} / 17,576`;
  };
  const verdict = (reg: ArrayLike<number>, pos: number) => {
    const n = D.liveCount(reg),
      tag = `<b class="mono">${D.posLetters(pos)}</b>`;
    if (n === 26)
      return `${tag}: all 26 wires live. Every partner for ${A[test]} is contradicted; this position is impossible.`;
    const truth =
      pos === trueStart
        ? ' This is the true start position.'
        : ' A false stop: a checker would try it on an Enigma and reject it.';
    if (n === 1)
      return `<b class="eq">Stop</b> at ${tag}: one wire live. The guess ${A[test]}–${A[hyp]} is consistent.${truth}`;
    if (n === 25) {
      const dark = A[Array.from(reg).findIndex(v => !v)];
      return `<b class="eq">Stop</b> at ${tag}: 25 wires live, one dark. ${A[test]} can only be plugged to <b>${dark}</b>${dark === A[test] ? ' (that is, left unplugged)' : ''}.${pos === trueStart ? ` The key sheet agrees: ${A[test]}–${A[partner(test)]}.` : truth}`;
    }
    return `<b class="eq">Stop</b> at ${tag}: ${n} wires live; the dark ones remain possible.${truth}`;
  };
  const build = () => {
    token++;
    running = false;
    const crib = D.CRIB.slice(0, Number(len.value));
    edges = D.menuOf(D.DEMO_CIPHER, crib, D.CRIB_AT);
    test = D.busiest(edges);
    hyp = test === 0 ? 1 : 0;
    bombe = new D.DemoBombe(D.DEMO_KEY, edges);
    const loops = edges.filter((_, k) => D.onLoop(edges, k)).length;
    // Closures c in the test letter's component: edges − letters + 1 (Turing's “chain-closing constatations”).
    const comp = new Set([test]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of edges)
        if (comp.has(e.a) !== comp.has(e.b)) {
          comp.add(e.a);
          comp.add(e.b);
          grew = true;
        }
    }
    closures = edges.filter(e => comp.has(e.a)).length - comp.size + 1;
    const only = closures === 1 ? D.shortestLoop(edges.filter(e => comp.has(e.a))) : null;
    evenLoop = !!only && only.edges.length % 2 === 0;
    $('blLenV')!.textContent = `${crib.length} letters`;
    $('blMenu')!.innerHTML = menuSvg(edges, test);
    $('blMenuCap')!.innerHTML =
      `<span class="mono">${crib}</span> at position ${D.CRIB_AT + 1}. ${edges.length} pairings, ${loops} of them on loops (brass), ${closures} closure${closures === 1 ? '' : 's'}. The ringed letter ${A[test]} is the test register, with the guess ${A[test]}–${A[hyp]}.`;
    cursor = 0;
    stops = 0;
    showDrums(0);
    showReg(new Uint8Array(26));
    $('blRead')!.innerHTML =
      `Press run: the drums step through every start position, and at each one the guess ${A[test]}–${A[hyp]} is set live and allowed to spread.`;
    run.textContent = 'Run the Bombe';
    run.disabled = false;
    $('blStats')!.innerHTML = '';
  };
  const compare = async (my: number) => {
    const t = token,
      counts: Record<string, number> = {};
    for (const d of [true, false]) {
      if (d === diag.checked) {
        counts[String(d)] = my;
        continue;
      }
      let s = 0;
      for (let p = 0; p < 17576; p++) {
        if (D.liveCount(bombe.test(p, test, hyp, d)) < 26) s++;
        if (p % 1500 === 0) {
          await nextFrame();
          if (t !== token) return;
        }
      }
      counts[String(d)] = s;
    }
    const cell = (n: number) => (n >= 17576 ? '<b class="no">every position</b>' : `<b>${fmtInt(n)}</b>`);
    const turing = closures <= 0 ? 17576 : Math.min(17576, 26 ** (4 - closures));
    const turingCell = turing >= 1 ? `≈ ${fmtInt(turing)}` : `≈ ${turing.toPrecision(2)}`;
    $('blStats')!.innerHTML =
      `<table class="bl-t"><tr><th></th><th>stops in 17,576</th></tr><tr><td>with the diagonal board</td><td>${cell(counts.true)}</td></tr><tr><td>without it (Turing's 1940 design)</td><td>${cell(counts.false)}</td></tr><tr><td>Turing's estimate without it, 26<sup>4−c</sup>, c = ${closures}</td><td>${turingCell}</td></tr></table>` +
      (evenLoop
        ? '<p class="fine">This menu has a single loop of even length. Each scrambler is an odd permutation, so an even loop composes to an even one and can never be a 26-cycle: without the board, every position stops (Weinbaum 2025).</p>'
        : '');
  };
  const go = async () => {
    if (running) {
      running = false;
      return;
    }
    running = true;
    run.textContent = 'Pause';
    const t = token;
    while (cursor < 17576) {
      const end = Math.min(17576, cursor + 90);
      let stopAt = -1,
        reg: Uint8Array | null = null;
      for (; cursor < end; cursor++) {
        const r = bombe.test(cursor, test, hyp, diag.checked);
        if (D.liveCount(r) < 26) {
          stopAt = cursor;
          reg = r;
          cursor++;
          stops++;
          break;
        }
        reg = r;
      }
      await nextFrame();
      if (t !== token) return;
      showDrums(stopAt >= 0 ? stopAt : cursor - 1);
      if (reg) showReg(reg);
      if (stopAt >= 0) {
        $('blRead')!.innerHTML = verdict(reg!, stopAt);
        if (stops <= 3 || stopAt === trueStart) {
          running = false;
          run.textContent = 'Continue';
          return;
        }
        $('blRead')!.innerHTML +=
          ' <span class="fine">Stops are coming thick and fast, so the machine no longer pauses for each; a checker would face every one.</span>';
      } else if (!running) {
        run.textContent = 'Continue';
        $('blRead')!.innerHTML = verdict(reg!, cursor - 1);
        return;
      }
    }
    running = false;
    run.textContent = 'Run again';
    cursor = 0;
    $('blRead')!.innerHTML =
      `Run complete: <b>${fmtInt(stops)}</b> stop${stops === 1 ? '' : 's'} in 17,576 positions, the true start <b class="mono">${D.posLetters(trueStart)}</b> among them. Each stop would have gone to a checker.`;
    const my = stops;
    stops = 0;
    compare(my);
  };
  run.onclick = () => {
    if (run.textContent === 'Run again') build();
    go();
  };
  $('blReset')!.onclick = build;
  len.addEventListener('input', build);
  diag.addEventListener('change', build);
  build();
}
