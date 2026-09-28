/**
 * Bletchley: the break, streamed from the server and played stage by stage.
 * Crib dragging, Jev's crib ranking, the Bombe per crib and wheel order, the
 * plugboard replay, Jev's verdict and the recovered key. The machine view
 * listens through `onEvent` (rotors spin while the Bombe runs, settle on a stop).
 */
import type { EnigmaKey } from '../../src/enigma/machine.js';
import type { Service } from '../../src/jev/cribs.js';
import type { Verdict } from '../../src/jev/judge.js';
import type { BreakEvent, BreakRequest, CandidateView, EventOf } from '../../src/web/events.js';
import { A, el, esc, groups, sleep } from '../shared/dom.js';

export type { BreakRequest, CandidateView };
/** The key and plaintext a message really had, when the page knows them. */
export type Truth = { key: EnigmaKey; plaintext: string; chToQ: boolean; sep: string; from: string };
export interface StageOptions {
  truth?: Truth | null;
  service?: string;
  onEvent?: (ev: BreakEvent) => void;
  onLocked?: () => void;
}
export type { Service };

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Weight of evidence in decibans, Turing's unit: 10·log₁₀ of the odds. */
const db = (p: number) => {
  const q = Math.min(0.9999, Math.max(0.0001, p));
  const v = 10 * Math.log10(q / (1 - q));
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)} dB`;
};

/** Stream a break into `host`; resolves when every stage has played. */
export async function runBreak(
  host: HTMLElement,
  req: BreakRequest,
  signal: AbortSignal,
  opts: StageOptions,
): Promise<void> {
  host.innerHTML = '';
  const stage = new Stage(host, req.ciphertext, opts);
  try {
    const res = await fetch('/api/break', { method: 'POST', signal, body: JSON.stringify(req) });
    if (res.status === 401) {
      stage.fail('The machine is locked: the key is needed again.');
      opts.onLocked?.();
      return;
    }
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (line.startsWith('data: ')) stage.push(JSON.parse(line.slice(6)) as BreakEvent);
      }
    }
    await stage.drain();
  } catch (err) {
    stage.fail((err as Error).name === 'AbortError' ? 'Stopped.' : String(err));
  }
}

/** Plays events in order, each at its own pace, however fast they arrive. */
export class Stage {
  private queue: BreakEvent[] = [];
  private running: Promise<void> | null = null;
  private bombeCards = new Map<
    string,
    { root: HTMLElement; fill: HTMLElement; info: HTMLElement; drums: HTMLElement[]; spin: number; orders?: number }
  >();
  private candidatesCard: HTMLElement | null = null;
  private candidates: CandidateView[] = [];
  private jevOn = false;
  /** 'German', 'English' or 'Spanish': what a right answer reads as. */
  private tongue = 'German';
  constructor(
    private host: HTMLElement,
    private ct: string,
    private opts: StageOptions = {},
  ) {}

  push(ev: BreakEvent) {
    this.queue.push(ev);
    this.running ??= this.loop();
  }
  async drain() {
    while (this.running) await this.running;
  }
  private async loop() {
    for (let ev = this.queue.shift(); ev; ev = this.queue.shift()) await this.handle(ev);
    this.running = null;
  }

  private card(title: string, tag = '', cls = '') {
    const li = el('li', `stage ${cls}`);
    li.append(el('h4', '', `<span>${title}</span><span class="tag ${cls.includes('jev') ? 'jev' : ''}">${tag}</span>`));
    this.host.append(li);
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return li;
  }
  fail(msg: string) {
    const c = this.card('Stopped', '', 'fail');
    c.append(el('div', 'fine', esc(msg)));
  }

  private async handle(ev: BreakEvent) {
    this.opts.onEvent?.(ev);
    switch (ev.type) {
      case 'intercept': {
        this.jevOn = ev.jev;
        this.tongue = ev.lang === 'en' ? 'English' : ev.lang === 'es' ? 'Spanish' : 'German';
        setTongue(this.tongue);
        const c = this.card(`Intercept · ${ev.letters} letters`, ev.jev ? `Jev ${ev.model}` : 'Jev off');
        c.append(el('div', 'groups cipher', groups(ev.ciphertext)));
        await sleep(350);
        break;
      }
      case 'drag': {
        const fits = ev.cribs.filter(c => c.fits);
        const c = this.card('Crib dragging', `${fits.length} of ${ev.cribs.length} cribs can open this message`);
        c.append(
          el(
            'p',
            'fine',
            'An Enigma never enciphers a letter to itself, so a crib is ruled out wherever one of its letters sits on the same cipher letter (red).',
          ),
        );
        const d = el('div', 'drag');
        const width = Math.min(26, this.ct.length);
        d.append(
          el(
            'div',
            'row ctline',
            `<span class="letters">${[...this.ct.slice(0, width)].map(x => `<span>${x}</span>`).join('')}</span><span class="badge">ciphertext</span>`,
          ),
        );
        c.append(d);
        const sorted = [...ev.cribs].sort((a, b) => Number(b.fits) - Number(a.fits));
        for (const k of sorted) {
          const letters = [...k.text.slice(0, width)]
            .map((x: string, j: number) => `<span class="${k.clashes.includes(j) ? 'clash' : ''}">${x}</span>`)
            .join('');
          d.append(
            el(
              'div',
              `row ${k.fits ? '' : 'out'}`,
              `<span class="letters">${letters}</span><span class="badge">${k.fits ? `fits · ${k.loops} loop${k.loops === 1 ? '' : 's'}` : 'ruled out'}</span>`,
            ),
          );
          await sleep(28);
        }
        break;
      }
      case 'jev-cribs': {
        const jev = ev.source === 'jev';
        const c = this.card(
          jev ? 'Jev ranks the cribs' : 'Cribs in list order',
          jev ? `choice question · ${Math.round(ev.latencyMs ?? 0)}ms` : 'Jev off',
          jev ? 'jev' : '',
        );
        c.append(
          el(
            'p',
            'fine',
            jev
              ? 'Asked which surviving phrase most likely opens this traffic. The Bombe tries them in this order and stops when Jev accepts a result.'
              : 'Without Jev the static list order is used.',
          ),
        );
        const bars = el('div', 'bars');
        const shown = ev.order.slice(0, 8);
        for (const [i, t] of shown.entries()) {
          const p = jev ? (ev.probabilities[t] ?? 0) : 0;
          const b = el(
            'div',
            `bar ${i === 0 ? 'picked' : ''}`,
            `<span class="name">${i + 1}. ${t}</span><span class="track"><span class="fill"></span></span><span class="val">${jev ? pct(p) : '–'}</span>`,
          );
          bars.append(b);
          requestAnimationFrame(
            () => ((b.querySelector('.fill') as HTMLElement).style.width = `${Math.max(2, p * 100)}%`),
          );
        }
        if (jev)
          bars.append(
            el(
              'div',
              'bar',
              `<span class="name">none of these</span><span class="track"><span class="fill" style="width:${ev.none * 100}%;opacity:.5"></span></span><span class="val">${pct(ev.none)}</span>`,
            ),
          );
        c.append(bars);
        if (!ev.order.length) c.append(el('p', 'fine missed', 'No listed crib fits the start of this message.'));
        await sleep(900);
        break;
      }
      case 'bombe-start': {
        const who = ev.source;
        const c = this.card(
          `Bombe · ${ev.crib}@${ev.at}`,
          `${who} · ${ev.turnovers === 'all' ? 'every middle-rotor turnover' : 'no turnover inside the crib'} · ${ev.loops} loop${ev.loops === 1 ? '' : 's'}`,
        );
        const wrap = el('div', 'bombe');
        wrap.append(menuSvg(ev.menu));
        const right = el('div');
        const drums = el('div', 'drums');
        const ds = [0, 1, 2].map(() => {
          const d = el('div', 'drum', 'A');
          drums.append(d);
          return d;
        });
        const prog = el('div', 'progress'),
          fill = el('div');
        prog.append(fill);
        const info = el(
          'div',
          'bombeInfo',
          `testing ${ev.orders} wheel orders × 17,576 positions on ${ev.workers} workers…<br><span class="fine">${then1940(ev.orders)}</span>`,
        );
        right.append(drums, prog, info);
        wrap.append(right);
        c.append(wrap);
        const spin = window.setInterval(
          () =>
            ds.forEach(d => {
              d.textContent = A[Math.floor(Math.random() * 26)];
            }),
          70,
        );
        this.bombeCards.set(ev.crib + ev.turnovers, { root: c, fill, info, drums: ds, spin, orders: ev.orders });
        await sleep(200);
        break;
      }
      case 'bombe-progress': {
        const b = [...this.bombeCards.values()].at(-1);
        if (b) {
          b.fill.style.width = `${(100 * ev.done) / ev.total}%`;
          b.info.innerHTML = `wheel order <b>${ev.order}</b> · ${ev.done}/${ev.total}<br>stops so far: <b>${ev.stops.toLocaleString()}</b>`;
        }
        break;
      }
      case 'bombe-done': {
        const b = this.bombeCards.get(ev.crib + ev.turnovers);
        if (!b) break;
        clearInterval(b.spin);
        b.fill.style.width = '100%';
        const head = `<span title="Consistent plugboard hypotheses, summed over the 26 guesses, every wheel order and every turnover variant: Turing's normal stops. An electrical Bombe counted positions.">${ev.stops.toLocaleString()} stops</span> in ${(ev.ms / 1000).toFixed(1)}s${b.orders ? ` <span class="fine">· ${bombeHours(b.orders)} on a 1940 Bombe</span>` : ''}`;
        if (ev.best && ev.accepted) {
          const k: EnigmaKey = ev.best.key;
          k.positions.forEach((p, i) => {
            b.drums[i].textContent = A[p];
          });
          b.root.classList.add('win-stage');
          b.info.innerHTML = `<span class="found">✓ stop confirmed</span> · ${head}<br>Walzenlage <b>${k.rotors.join(' ')}</b> · rings <b>${k.rings.map(x => A[x]).join('')}</b> · start <b>${k.positions.map(x => A[x]).join('')}</b><br>plugs fixed by the menu: <b>${esc(ev.best.seedPlugboard || '—')}</b>`;
        } else {
          b.drums.forEach(d => {
            d.textContent = '·';
          });
          b.info.innerHTML = `<span class="missed">✗ no stop reads as ${this.tongue}</span> · ${head}`;
        }
        b.info.append(
          ev.decidedBy === 'stats' && this.tongue !== 'German'
            ? statsLine(ev, this.tongue)
            : jevLine(ev.jev, ev.accepted),
        );
        if (ev.thin)
          b.info.append(
            el(
              'div',
              'fine',
              'Not accepted: the crib covers nearly the whole message, so there is too little text beyond it to judge.',
            ),
          );
        if (typeof ev.disagree === 'number')
          b.info.append(
            el(
              'div',
              'fine',
              `Not accepted: Jev leaned yes, but the German letter statistics disagree (fit ${ev.disagree.toFixed(2)}, floor 0.42). Two judges must agree.`,
            ),
          );
        await sleep(450);
        break;
      }
      case 'climb-start': {
        const c = this.card('Ciphertext-only scan & hill-climb', `${ev.orders} wheel orders`);
        c.append(
          el(
            'p',
            'fine',
            'No crib broke it. Last resort: score every setting by index of coincidence, then climb the plugboard. Works with few plugs or long messages; with 10 plugs it rarely does.',
          ),
        );
        const prog = el('div', 'progress'),
          fill = el('div');
        prog.append(fill);
        const info = el('div', 'bombeInfo', 'scanning…');
        c.append(prog, info);
        this.bombeCards.set('climb', { root: c, fill, info, drums: [], spin: 0 });
        break;
      }
      case 'climb-progress': {
        const b = this.bombeCards.get('climb');
        if (b) {
          b.fill.style.width = `${(100 * ev.done) / ev.total}%`;
          b.info.textContent = `${ev.stage} ${ev.done}/${ev.total}`;
        }
        break;
      }
      case 'climb-done': {
        const b = this.bombeCards.get('climb');
        if (b) {
          b.fill.style.width = '100%';
          b.info.innerHTML = ev.accepted
            ? `<span class="found">✓ reads as ${this.tongue}</span> after ${(ev.ms / 1000).toFixed(1)}s`
            : `<span class="missed">✗ nothing reads as ${this.tongue}</span> after ${(ev.ms / 1000).toFixed(1)}s`;
          b.info.append(
            ev.decidedBy === 'stats' && this.tongue !== 'German'
              ? statsLine(ev, this.tongue)
              : jevLine(ev.jev, ev.accepted),
          );
        }
        break;
      }
      case 'replay': {
        const c = this.card('Plugboard', `hill-climb replay · ${ev.frames.length} steps`);
        c.append(
          el(
            'p',
            'fine',
            'Starting from the plugs the Bombe fixed (green), each swap that makes the text more German is kept.',
          ),
        );
        const board = el('div', 'plugboard');
        const sockets = [...A].map(ch => {
          const s = el('div', `socket ${ev.locked.includes(ch) ? 'locked' : ''}`, `${ch}<b></b>`);
          board.append(s);
          return s;
        });
        const text = el('div', 'resolve');
        c.append(board, text);
        let prev = '';
        for (const f of ev.frames as Array<{ plugboard: string; plaintext: string }>) {
          const partner: Record<string, string> = {};
          for (const p of f.plugboard.split(' ').filter(Boolean)) {
            partner[p[0]] = p[1];
            partner[p[1]] = p[0];
          }
          sockets.forEach((s, i) => {
            const m = partner[A[i]] ?? '';
            s.querySelector('b')!.textContent = m;
            s.classList.toggle('on', !!m);
          });
          text.innerHTML = groups(f.plaintext)
            .split('')
            .map((ch, i) => {
              const j = i - Math.floor(i / 6);
              return ch !== ' ' && prev && prev[j] !== ch ? `<span class="chg">${ch}</span>` : ch;
            })
            .join('');
          prev = f.plaintext;
          await sleep(160);
        }
        break;
      }
      case 'candidates': {
        this.candidates = ev.candidates;
        const c = this.card(
          this.jevOn ? 'Jev reads the candidates' : 'Candidates',
          this.jevOn ? 'choice + P(correct) · waiting…' : 'n-gram score',
          this.jevOn ? 'jev' : '',
        );
        const list = el('div', 'cands');
        for (const [i, k] of ev.candidates.entries())
          list.append(
            el(
              'div',
              'cand',
              `<div class="meta"><b>${'ABC'[i]}</b><span>${k.key.rotors.join('-')} · ${k.key.positions.map(x => A[x]).join('')}</span><span>German-ness ${Math.max(0, k.germanness).toFixed(2)}</span><span class="jevp"></span></div><div class="ctext">${esc(k.plaintext.slice(0, 160))}${k.plaintext.length > 160 ? '…' : ''}</div>`,
            ),
          );
        c.append(list);
        this.candidatesCard = c;
        break;
      }
      case 'jev-judge': {
        const c = this.candidatesCard;
        if (!c) break;
        c.querySelector('.tag')!.textContent = `choice + P(correct) · ${Math.round(ev.latencyMs)}ms`;
        const cards = [...c.querySelectorAll('.cand')] as HTMLElement[];
        cards.forEach((card, i) => {
          const p = ev.readable[i] ?? 0;
          card.querySelector('.jevp')!.innerHTML = `Jev P(correct) <span class="pbar"><i></i></span> ${pct(p)}`;
          requestAnimationFrame(() => ((card.querySelector('.pbar i') as HTMLElement).style.width = `${p * 100}%`));
          if (i === ev.pick) card.classList.add('pick');
        });
        if (ev.advisory)
          c.append(
            el(
              'p',
              'fine',
              `Advisory for ${this.tongue} text: Jev was evaluated on German traffic and reads run-together ${this.tongue} poorly, so the letter statistics decide here.`,
            ),
          );
        c.append(
          el(
            'div',
            'verdict',
            ev.accepted >= 0
              ? `<span class="found">Jev accepts ${'ABC'[ev.accepted]}</span> <span class="fine">(choice ${pct(ev.pickProbability)}, P(correct) ${pct(ev.readable[ev.accepted])})</span>`
              : `<span class="missed">Jev does not accept any candidate</span> <span class="fine">(argmax ${ev.pick < 0 ? 'none' : 'ABC'[ev.pick]} at ${pct(ev.pickProbability)}; needs ≥ 50% on both questions)</span>`,
          ),
        );
        await sleep(700);
        break;
      }
      case 'note': {
        const c = this.card(esc(ev.title), '', 'fail');
        c.append(el('p', 'fine', esc(ev.body)));
        await sleep(300);
        break;
      }
      case 'jev-error': {
        const c = this.card('Jev unavailable', ev.stage, 'fail');
        c.append(el('div', 'fine', esc(ev.message)));
        break;
      }
      case 'result':
        this.result(ev);
        break;
      case 'error':
        this.fail(ev.message);
        break;
    }
  }

  private result(ev: EventOf<'result'>) {
    const cand: CandidateView | null = ev.candidate;
    const t = this.opts.truth ?? null;
    const acc =
      t && cand ? [...t.plaintext].filter((ch, i) => cand.plaintext[i] === ch).length / t.plaintext.length : null;
    // Accepted, but not what was sent: say so. A confident wrong answer is the worst outcome a demo can show.
    const falseBreak = ev.chosen >= 0 && acc !== null && acc < 0.9;
    const ok = ev.chosen >= 0 && !falseBreak;
    const c = this.card(
      falseBreak ? 'A false break' : ok ? 'Broken' : 'Not broken',
      esc(ev.verdict),
      ok ? 'win-stage' : 'fail',
    );
    if (falseBreak)
      c.append(
        el(
          'p',
          'missed',
          `The search found a key that turns the intercept into German, but it is not the sender's key: the plaintext matches ${pct(acc!)} of what was sent. With ${this.ct.length} letters, many keys produce plausible text. That is the unicity problem, and why Bletchley wanted long messages.`,
        ),
      );
    if (!cand) {
      c.append(el('p', 'fine', 'No candidates.'));
      return;
    }
    const k = cand.key;
    const rows: string[] = [];
    const cell = (label: string, got: string, want: string | null, verdict: string) =>
      rows.push(
        `<tr><th>${label}</th><td class="mono">${got}</td>${t ? `<td class="mono">${want}</td><td>${verdict}</td>` : ''}</tr>`,
      );
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const decryptsSame = acc !== null && acc > 0.99;
    const pairs = (s: string) =>
      s
        .split(/\s+/)
        .filter(Boolean)
        .map(p => [...p].sort().join(''))
        .sort()
        .join(' ');
    cell(
      'Walzenlage',
      k.rotors.join(' '),
      t ? t.key.rotors.join(' ') : null,
      t ? (same(k.rotors, t.key.rotors) ? '<span class="ok">✓</span>' : '<span class="no">✗</span>') : '',
    );
    const eqNote = decryptsSame
      ? '<span class="eq">≡ equivalent</span> <span class="fine">(same rotor offsets, decrypts identically; a ring and its start letter only matter together)</span>'
      : '<span class="no">differs</span>';
    cell(
      'Ringstellung',
      k.rings.map(x => A[x]).join(' '),
      t ? t.key.rings.map(x => A[x]).join(' ') : null,
      t ? (same(k.rings, t.key.rings) ? '<span class="ok">✓</span>' : eqNote) : '',
    );
    cell(
      'Grundstellung',
      k.positions.map(x => A[x]).join(' '),
      t ? t.key.positions.map(x => A[x]).join(' ') : null,
      t ? (same(k.positions, t.key.positions) ? '<span class="ok">✓</span>' : eqNote) : '',
    );
    cell(
      'Stecker',
      k.plugboard || '—',
      t ? t.key.plugboard || '—' : null,
      t
        ? pairs(k.plugboard) === pairs(t.key.plugboard)
          ? '<span class="ok">✓</span>'
          : decryptsSame
            ? '<span class="eq">≡ same text</span>'
            : '<span class="no">differs</span>'
        : '',
    );
    cell(
      'Reflector',
      `UKW ${k.reflector}`,
      t ? `UKW ${t.key.reflector}` : null,
      t ? (k.reflector === t.key.reflector ? '<span class="ok">✓</span>' : '<span class="no">✗</span>') : '',
    );
    c.append(
      el(
        'table',
        'keycmp',
        `<tr><th></th><th>recovered</th>${t ? `<th>${esc(t.from)}</th><th></th>` : ''}</tr>${rows.join('')}`,
      ),
    );
    if (acc !== null)
      c.append(el('p', acc > 0.9 ? 'found' : 'missed', `Plaintext matches ${esc(t!.from)} at ${pct(acc)} of letters.`));
    c.append(el('div', 'final', groups(cand.plaintext)));
    let reading = cand.plaintext.replace(/XX/g, ': ').replace(/X/g, ' ').replace(/J/g, ' ');
    if (this.opts.service === 'Heer') reading = reading.replace(/Q/g, 'CH');
    c.append(el('div', 'reading', `reading aid: ${esc(reading.toLowerCase())}`));
    c.append(el('p', 'fine', `Jev requests this session: ${ev.jevCalls}. Via ${esc(cand.via)}.`));
  }
}

/** One line under a Bombe or climb run: what Jev made of its best candidates. */
/** For English or Spanish traffic the language's letter statistics decide; Jev's reading is advice. */
function statsLine(ev: EventOf<'bombe-done'> | EventOf<'climb-done'>, tongue: string): HTMLElement {
  const fit = typeof ev.fit === 'number' ? ev.fit.toFixed(2) : '–';
  const advice = ev.jev
    ? ` · Jev advised: ${ev.jev.accepted >= 0 ? `accept (P(correct) ${pct(ev.jev.readable[ev.jev.accepted])})` : `reject (best P(correct) ${pct(Math.max(...ev.jev.readable))})`}`
    : '';
  return el(
    'div',
    '',
    `<span style="color:var(--jev)">${tongue} letter statistics: ${ev.accepted ? 'accept' : 'reject'} (fit ${fit}, bar 0.55)</span><span class="fine">${advice}</span>`,
  );
}

let TONGUE = 'German';
const setTongue = (t: string) => {
  TONGUE = t;
};
function jevLine(v: Verdict | null, accepted: boolean): HTMLElement {
  if (!v) return el('div', 'fine', accepted ? 'n-gram bar passed (Jev off)' : '');
  const best = Math.max(...v.readable);
  return el(
    'div',
    '',
    accepted
      ? `<span style="color:var(--jev)">Jev reads it: ${TONGUE} (choice ${pct(v.pickProbability)}, P(correct) ${pct(v.readable[v.accepted])} · ${db(v.readable[v.accepted])} in Turing's decibans)</span>`
      : `<span style="color:var(--jev)">Jev reads it: not ${TONGUE}</span> <span class="fine">(best P(correct) ${pct(best)}, “none” ${pct(v.noneProbability)})</span>`,
  );
}

/** A 1940 Bombe took roughly a quarter of an hour per wheel order (the Bletchley rebuild: about 13 minutes for 17,576 positions). */
function bombeHours(orders: number): string {
  const min = orders * 15;
  return min < 90 ? `≈ ${min} min` : `≈ ${Math.round(min / 60)} h`;
}
function then1940(orders: number): string {
  return `In 1940 one Bombe needed about a quarter of an hour per wheel order: ${bombeHours(orders)} for this pass, and every stop was then checked by hand.`;
}

/** The Bombe menu: crib and cipher letters as nodes, one edge per crib position; edges that close a loop in brass. */
function menuSvg(menu: Array<[string, string, number]>): HTMLElement {
  const letters = [...new Set(menu.flatMap(m => m.slice(0, 2) as string[]))].sort();
  const n = letters.length,
    R = 80,
    cx = 105,
    cy = 100;
  const at = (ch: string) => {
    const i = letters.indexOf(ch),
      a = (2 * Math.PI * i) / n - Math.PI / 2;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  };
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    parent[x] ??= x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const crib = new Set(menu.map(m => m[0]));
  let edges = '';
  for (const [p, c, j] of menu) {
    const loop = find(p) === find(c);
    if (!loop) parent[find(p)] = find(c);
    const [x1, y1] = at(p),
      [x2, y2] = at(c);
    edges += `<line class="edge ${loop ? 'loop' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><title>position ${j + 1}: ${p}↔${c}</title></line>`;
  }
  const nodes = letters
    .map(ch => {
      const [x, y] = at(ch);
      return `<circle class="node ${crib.has(ch) ? 'crib' : ''}" cx="${x}" cy="${y}" r="10"/><text x="${x}" y="${y + 4}" text-anchor="middle">${ch}</text>`;
    })
    .join('');
  const box = el('div', 'menu');
  box.innerHTML = `<svg viewBox="0 0 210 200" role="img" aria-label="Bombe menu">${edges}${nodes}</svg><div class="fine">menu · brass edges close loops</div>`;
  return box;
}
