/**
 * A three-dimensional Enigma I in CSS, modelled on the machine itself:
 *
 *   case       honey oak, with a rim, inner walls and a bottom rail
 *   lid        a shallow wooden box hinged at the back; inside, as on the
 *              real lid: spare bulbs, the green contrast filter, the
 *              “Zur Beachtung!” instruction sheet and two spare cables
 *   deck       black crinkle-finish metal: the rotor cover with three knurled
 *              thumbwheels (real 26-facet prisms that roll a step per letter)
 *              and their letter windows, UKW B, the power selector and the
 *              lampboard; then the keyboard on three descending terraces, each
 *              key a nickel-rimmed cap on a stem
 *   front      the plugboard (Steckerbrett), behind a hinged front flap that
 *              falls open whenever the plugs are in use and closes for operation,
 *              as the manual required
 *
 * Geometry is computed here (one helper places every face) so proportions stay
 * in one place. The class only draws and reports: which key was pressed, which
 * rotor was turned, which socket was clicked. The cipher is src/enigma/machine.ts.
 */
import { A } from '../shared/dom.js';
export const QWERTZ = ['QWERTZUIO', 'ASDFGHJK', 'PYXCVBNML'];

export type Camera = 'hero' | 'closed' | 'deck' | 'plugboard' | 'bombe' | 'overview';

export interface MachineEvents {
  onOpen?: () => void;
  onKey?: (letter: string) => void;
  onRotor?: (index: number, delta: number) => void;
  onSocket?: (letter: string) => void;
}

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

// ── Proportions (px). The real case is about 34 × 28 × 15 cm. ──
const W = 680,
  D = 540,
  H = 236,
  T = 16; // case width, depth, height; wood thickness
const RIM = -H / 2; // y of the case rim (y grows downward)
const LH = 46; // lid depth
const PW = W - 2 * T; // inner width
const BACK = -D / 2 + T,
  PLUG_Z = D / 2 - T - 8; // inner back wall; plugboard face
const DECK_Y = RIM + 18; // rotor cover and lampboard level
const KEY_Z0 = 84,
  ROW_D = (PLUG_Z - KEY_Z0) / 3; // keyboard terraces
const STEP = 13; // drop per terrace
const HINGE_Y = 66; // bottom of the front flap
const WHEEL_R = 30,
  FACETS = 26;

type Orient = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
const ORIENT: Record<Orient, string> = {
  top: 'rotateX(90deg)',
  bottom: 'rotateX(-90deg)',
  front: '',
  back: 'rotateY(180deg)',
  left: 'rotateY(-90deg)',
  right: 'rotateY(90deg)',
};

/** One flat face, centred at (x, y, z) and turned to face `o`. */
function face(cls: string, w: number, ht: number, x: number, y: number, z: number, o: Orient, html = ''): HTMLElement {
  const e = h('div', `em-f ${cls}`, html);
  Object.assign(e.style, {
    width: `${w}px`,
    height: `${ht}px`,
    left: `${-w / 2}px`,
    top: `${-ht / 2}px`,
    transform: `translate3d(${x}px, ${y}px, ${z}px) ${ORIENT[o]}`,
  });
  return e;
}
/** A stack of discs reads as a short cylinder from any angle. */
function cylinder(cls: string, d: number, height: number, layers: number, topHtml = ''): HTMLElement {
  const c = h('div', `em-cyl ${cls}`);
  for (let k = 0; k < layers; k++) {
    const disc = h('div', `em-disc${k === layers - 1 ? ' cap' : ''}`, k === layers - 1 ? topHtml : '');
    Object.assign(disc.style, {
      width: `${d}px`,
      height: `${d}px`,
      left: `${-d / 2}px`,
      top: `${-d / 2}px`,
      transform: `translateZ(${(height * k) / Math.max(1, layers - 1)}px)`,
    });
    c.append(disc);
  }
  return c;
}
/** A short upright post (two crossed planes), rising `len` from its plane. */
function post(cls: string, w: number, len: number): HTMLElement {
  const p = h('div', `em-post ${cls}`);
  for (const r of ['', 'rotateZ(90deg) ']) {
    const s = h('div', 'em-post-s');
    Object.assign(s.style, {
      width: `${w}px`,
      height: `${len}px`,
      left: `${-w / 2}px`,
      top: `${-len / 2}px`,
      transform: `${r}translateZ(${len / 2}px) rotateX(90deg)`,
    });
    p.append(s);
  }
  return p;
}
/** Place a child at (x, y) on a horizontal plane, raised by z. */
const at = (e: HTMLElement, x: number, y: number, z = 0) => {
  e.style.transform = `translate3d(${x}px, ${y}px, calc(${z}px + var(--lift, 0px))) translate(-50%, -50%)`;
  return e;
};

export class Machine3D {
  readonly root: HTMLElement;
  private rig: HTMLElement;
  private wins: HTMLElement[] = [];
  private wheels: HTMLElement[] = [];
  private labels: HTMLElement[] = [];
  private lamps = new Map<string, HTMLElement>();
  private keys = new Map<string, HTMLElement>();
  private sockets = new Map<string, HTMLElement>();
  private cables: SVGSVGElement;
  private board: HTMLElement;
  private wheelTurn = [0, 0, 0];
  private spinTimer = 0;
  private open = false;
  private flapPinned = false;
  interactive = { keys: false, rotors: false, sockets: false };

  constructor(
    host: HTMLElement,
    private ev: MachineEvents = {},
  ) {
    this.root = h('div', 'em-scene');
    this.rig = h('div', 'em-rig');
    this.root.append(this.rig);
    const box = h('div', 'em-box');
    this.rig.append(box);

    // ── Case: outer walls, bottom, rim and the inner walls you see into ──
    box.append(
      h('div', 'em-shadow'),
      face('em-wood em-side', D, H, -W / 2, 0, 0, 'left'),
      face('em-wood em-side', D, H, W / 2, 0, 0, 'right'),
      face('em-wood', W, H, 0, 0, -D / 2, 'back'),
      face('em-wood em-under', W, D, 0, H / 2, 0, 'bottom'),
      face('em-wood em-rail', W, H / 2 - HINGE_Y, 0, (HINGE_Y + H / 2) / 2, D / 2, 'front', '<i class="em-hinge"></i>'),
      face('em-wood em-rim', W, T, 0, RIM, -D / 2 + T / 2, 'top'),
      face('em-wood em-rim', T, D, -W / 2 + T / 2, RIM, 0, 'top'),
      face('em-wood em-rim', T, D, W / 2 - T / 2, RIM, 0, 'top'),
      face('em-wood em-inner', D - 2 * T, HINGE_Y - RIM, -W / 2 + T, (HINGE_Y + RIM) / 2, 0, 'right'),
      face('em-wood em-inner', D - 2 * T, HINGE_Y - RIM, W / 2 - T, (HINGE_Y + RIM) / 2, 0, 'left'),
      face('em-wood em-inner', PW, DECK_Y - RIM, 0, (DECK_Y + RIM) / 2, BACK, 'front'),
      face('em-wood em-ledge', PW, D / 2 - PLUG_Z, 0, HINGE_Y, (D / 2 + PLUG_Z) / 2, 'top'),
    );

    // ── Deck: rotor cover and lampboard ──
    const deckD = KEY_Z0 - BACK;
    const deck = face('em-metal em-deck', PW, deckD, 0, DECK_Y, (BACK + KEY_Z0) / 2, 'top');
    box.append(deck);
    const cover = at(h('div', 'em-cover'), PW / 2 + 12, 70, 0.3);
    deck.append(cover);
    const ukw = at(h('div', 'em-ukw', '<span>UKW</span><b>B</b>'), 86, 70);
    ukw.dataset.tr = 'm.ukw';
    deck.append(ukw);
    const xs = [PW / 2 - 110, PW / 2, PW / 2 + 110];
    for (let i = 0; i < 3; i++) {
      const slot = at(h('div', 'em-slot'), xs[i] + 14, 70, 0.5);
      const label = at(h('div', 'em-rlabel', ['II', 'IV', 'V'][i]), xs[i] - 30, 30, 1);
      const win = at(h('button', 'em-win', '<span>A</span>'), xs[i] - 30, 70, 1);
      win.setAttribute('aria-label', `Rotor ${i + 1} window`);
      const wheel = h('div', 'em-wheel');
      wheel.style.transform = `translate3d(${xs[i] + 14}px, 70px, 0px) rotateX(var(--turn, 0deg))`;
      for (let k = 0; k < FACETS; k++) {
        const f = h('div', `em-facet${k % 2 ? ' alt' : ''}`);
        const fh = (2 * Math.PI * WHEEL_R) / FACETS + 0.6;
        Object.assign(f.style, {
          height: `${fh}px`,
          top: `${-fh / 2}px`,
          transform: `rotateX(${(360 * k) / FACETS}deg) translateZ(${WHEEL_R}px)`,
        });
        wheel.append(f);
      }
      label.dataset.tr = 'm.rotor';
      win.dataset.tr = 'm.window';
      wheel.dataset.tr = 'm.wheel';
      win.addEventListener('click', () => this.interactive.rotors && this.ev.onRotor?.(i, 1));
      wheel.addEventListener('click', () => this.interactive.rotors && this.ev.onRotor?.(i, -1));
      for (const t of [win, wheel])
        t.addEventListener(
          'wheel',
          e => {
            if (!this.interactive.rotors) return;
            e.preventDefault();
            this.ev.onRotor?.(i, (e as WheelEvent).deltaY > 0 ? 1 : -1);
          },
          { passive: false },
        );
      deck.append(slot, label, win, wheel);
      this.wins.push(win);
      this.wheels.push(wheel);
      this.labels.push(label);
    }
    // Power selector, external power terminals, locking bolts, the filter clip.
    deck.append(
      at(
        h(
          'div',
          'em-dial',
          '<i></i><span class="a">1</span><span class="b">2</span><span class="c">3</span><span class="d">4</span>',
        ),
        PW - 96,
        74,
        1,
      ),
      at(cylinder('em-knob', 22, 10, 4), PW - 50, 52),
      at(cylinder('em-knob', 22, 10, 4), PW - 50, 96),
      at(cylinder('em-bolt', 20, 12, 5), 34, deckD - 40),
      at(cylinder('em-bolt', 20, 12, 5), PW - 34, deckD - 40),
      at(h('div', 'em-clip'), PW - 34, 150),
    );
    const lampRows = [148, 202, 256].map(y => y + (deckD - 330) / 2);
    QWERTZ.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        const x = PW / 2 + (c - (row.length - 1) / 2) * 60;
        const lamp = at(h('div', 'em-lamp', `<span>${ch}</span>`), x, lampRows[r], 0.5);
        lamp.dataset.tr = 'm.lamp';
        this.lamps.set(ch, lamp);
        deck.append(lamp);
      });
    });

    // ── Keyboard: three terraces, each key a capped cylinder on a stem ──
    QWERTZ.forEach((row, r) => {
      const y = DECK_Y + STEP * (r + 1),
        z0 = KEY_Z0 + r * ROW_D;
      const terrace = face('em-metal em-terrace', PW, ROW_D, 0, y, z0 + ROW_D / 2, 'top');
      box.append(terrace, face('em-metal em-riser', PW, STEP, 0, y - STEP / 2, z0, 'front'));
      [...row].forEach((ch, c) => {
        const x = PW / 2 + (c - (row.length - 1) / 2) * 62;
        const key = at(h('button', 'em-key'), x, ROW_D / 2);
        key.setAttribute('aria-label', `Key ${ch}`);
        key.dataset.tr = 'm.key';
        key.append(post('em-stem', 7, 24), at(cylinder('em-cap', 44, 9, 5, `<span>${ch}</span>`), 0, 0, 24));
        // Press on pointer-down (as a real key acts on the way down). Mouse-down covers input paths
        // without pointer events; a keyboard-activated click (detail 0) covers Enter/Space on a focused key.
        let lastDown = 0;
        const press = (e: Event) => {
          e.preventDefault();
          const now = performance.now();
          if (now - lastDown < 60) return;
          lastDown = now;
          if (this.interactive.keys) this.ev.onKey?.(ch);
        };
        key.addEventListener('pointerdown', press);
        key.addEventListener('mousedown', press);
        key.addEventListener('click', e => {
          if ((e as MouseEvent).detail === 0 && this.interactive.keys) this.ev.onKey?.(ch);
        });
        this.keys.set(ch, key);
        terrace.append(key);
      });
    });

    // ── Plugboard, on the front below the keyboard, with a layer for cables ──
    const plugTop = DECK_Y + STEP * 3;
    const front = face('em-metal em-plugpanel', PW, HINGE_Y - plugTop, 0, (HINGE_Y + plugTop) / 2, PLUG_Z, 'front');
    this.board = h('div', 'em-plugboard');
    for (const row of QWERTZ) {
      const r = h('div', 'em-prow');
      for (const ch of row) {
        const s = h('button', 'em-socket', `<i>${ch}</i><span class="holes"><b></b><b></b></span>`);
        s.setAttribute('aria-label', `Plug socket ${ch}`);
        s.dataset.tr = 'm.socket';
        s.addEventListener('click', () => this.interactive.sockets && this.ev.onSocket?.(ch));
        this.sockets.set(ch, s);
        r.append(s);
      }
      this.board.append(r);
    }
    this.cables = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.cables.setAttribute('class', 'em-cables');
    const plate = h('div', 'em-frontplate', 'Steckerbrett');
    plate.dataset.tr = 'm.plugboard';
    front.append(this.board, this.cables, plate, h('div', 'em-serial', 'A 16081'));
    box.append(front);

    // ── Front flap, hinged at the bottom: closed in use, down for the plugs ──
    const flapH = HINGE_Y - RIM;
    const flap = h('div', 'em-flap');
    Object.assign(flap.style, { transform: `translate3d(0px, ${HINGE_Y}px, ${D / 2}px) rotateX(var(--flap-a))` });
    flap.append(
      face(
        'em-wood em-flap-out',
        W,
        flapH,
        0,
        -flapH / 2,
        0,
        'front',
        '<i class="em-caselock"></i><i class="em-flaplatch l"></i><i class="em-flaplatch r"></i>',
      ),
      face(
        'em-wood em-flap-in',
        W,
        flapH,
        0,
        -flapH / 2,
        -1,
        'back',
        '<span>Klappe beim Betrieb geschlossen halten</span>',
      ),
      face('em-wood em-rim', W, T, 0, -flapH, -T / 2, 'top'),
    );
    flap.dataset.tr = 'm.flap';
    flap.addEventListener('click', () => {
      if (!this.open) this.ev.onOpen?.();
    });
    box.append(flap);

    // ── Lid: a shallow box hinged at the back of the rim ──
    const lid = h('div', 'em-lidbox');
    Object.assign(lid.style, { transform: `translate3d(0px, ${RIM}px, ${-D / 2}px) rotateX(var(--lid-a))` });
    const L = (cls: string, w: number, ht: number, x: number, y: number, z: number, o: Orient, html = '') =>
      lid.append(face(cls, w, ht, x, y, z, o, html));
    L('em-wood em-lid-top', W, D, 0, -LH, D / 2, 'top', '<div class="em-lid-plate" data-tr="m.lid">ENIGMA</div>');
    L('em-wood em-lid-lip', W, LH, 0, -LH / 2, D, 'front', '<i class="em-hasp"></i>');
    L('em-wood em-lid-lip', W, LH, 0, -LH / 2, 0, 'back');
    L('em-wood em-lid-lip', D, LH, -W / 2, -LH / 2, D / 2, 'left');
    L('em-wood em-lid-lip', D, LH, W / 2, -LH / 2, D / 2, 'right');
    // Inside faces, seen when the lid stands open.
    L('em-wood em-lid-lipin', W, LH, 0, -LH / 2, D - T / 2, 'back');
    L('em-wood em-lid-lipin', D, LH, -W / 2 + T / 2, -LH / 2, D / 2, 'right');
    L('em-wood em-lid-lipin', D, LH, W / 2 - T / 2, -LH / 2, D / 2, 'left');
    L(
      'em-wood em-lid-under',
      W - 2,
      D - 2,
      0,
      -LH + 1,
      D / 2,
      'bottom',
      `
      <div class="em-bulbs">${'<i></i>'.repeat(10)}</div>
      <div class="em-filter"><span>Geheim!</span></div>
      <div class="em-sheet" data-tr="m.note"><b>Zur Beachtung!</b><small>Gebrauchsanleitung für die Chiffriermaschine (H. Dv. g. 13)</small><p></p><em>A B C D E F G H I J K L M N O P Q R S T U V W X Y Z</em></div>
      <svg class="em-spare" viewBox="0 0 600 70" preserveAspectRatio="none"><path d="M40 20 C160 70 440 -10 560 38"/><path d="M40 44 C200 90 400 10 560 16"/></svg>
      <i class="em-holder l1"></i><i class="em-holder l2"></i><i class="em-holder r1"></i><i class="em-holder r2"></i>`,
    );
    lid.addEventListener('click', () => {
      if (!this.open) this.ev.onOpen?.();
    });
    box.append(lid);

    host.append(this.root);
    this.fit(host);
    new ResizeObserver(() => this.fit(host)).observe(host);
    window.addEventListener('resize', () => this.fit(host));
    this.parallax();
    this.setCamera('closed');
  }

  /** Scale the scene to its container; the machine is drawn at a fixed size. */
  private fit(host: HTMLElement) {
    // Height kept free around the machine; the locked view reserves room for the key card (--reserve on the host).
    const reserve = parseFloat(getComputedStyle(host).getPropertyValue('--reserve')) || 170;
    const s = Math.max(0.36, Math.min(0.98, host.clientWidth / 880, (window.innerHeight - reserve) / 730));
    this.root.style.setProperty('--fit', String(s));
    // Neighbours of the machine (the key card) size themselves against it.
    host.parentElement?.style.setProperty('--machine-fit', String(s));
  }

  /** A few degrees of pointer parallax, so the machine feels like an object. */
  private parallax() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.root.addEventListener('pointermove', e => {
      const r = this.root.getBoundingClientRect();
      this.root.style.setProperty('--px', (((e.clientX - r.left) / r.width - 0.5) * 6).toFixed(2));
      this.root.style.setProperty('--py', (((e.clientY - r.top) / r.height - 0.5) * -4).toFixed(2));
    });
    this.root.addEventListener('pointerleave', () => {
      this.root.style.setProperty('--px', '0');
      this.root.style.setProperty('--py', '0');
    });
  }

  setCamera(c: Camera) {
    this.root.dataset.camera = c;
    this.syncFlap();
  }
  /** Re-measure after the layout around the machine changes. */
  refit() {
    if (this.root.parentElement) this.fit(this.root.parentElement);
  }

  async openLid() {
    if (this.open) return;
    this.open = true;
    this.root.classList.add('is-open');
    await new Promise(r => setTimeout(r, 1100));
  }
  closeLid() {
    this.open = false;
    this.root.classList.remove('is-open');
    this.syncFlap();
  }
  get isOpen() {
    return this.open;
  }

  /** Hold the front flap open (e.g. to show a recovered plugboard); otherwise it follows the plugboard's use. */
  setFlap(open: boolean) {
    this.flapPinned = open;
    this.syncFlap();
  }
  private syncFlap() {
    const open = this.open && (this.flapPinned || this.interactive.sockets || this.root.dataset.camera === 'plugboard');
    this.root.classList.toggle('flap-open', open);
  }

  setInteractive(opts: Partial<Machine3D['interactive']>) {
    Object.assign(this.interactive, opts);
    this.root.classList.toggle('keys-live', this.interactive.keys);
    this.root.classList.toggle('rotors-live', this.interactive.rotors);
    this.root.classList.toggle('sockets-live', this.interactive.sockets);
    if (!this.interactive.sockets) this.flapPinned = false;
    this.syncFlap();
  }

  setRotorNames(names: readonly string[]) {
    names.forEach((n, i) => {
      this.labels[i].textContent = n;
    });
  }

  /** Show window letters; `roll` turns the thumbwheel of any rotor that moved, one facet per step. */
  setWindows(pos: readonly number[], roll = true) {
    pos.forEach((p, i) => {
      const span = this.wins[i].querySelector('span')!;
      const letter = A[((p % 26) + 26) % 26];
      if (span.textContent === letter) return;
      if (roll) {
        const prev = A.indexOf(span.textContent ?? 'A');
        const d = ((A.indexOf(letter) - prev + 39) % 26) - 13;
        this.wheelTurn[i] -= (360 / FACETS) * (d || 1);
        this.wheels[i].style.setProperty('--turn', `${this.wheelTurn[i]}deg`);
        span.classList.remove('roll');
        void span.offsetWidth;
        span.classList.add('roll');
      }
      span.textContent = letter;
    });
  }

  press(letter: string) {
    const k = this.keys.get(letter);
    if (!k) return;
    k.classList.add('down');
    setTimeout(() => k.classList.remove('down'), 150);
  }

  light(letter: string, ms = 260) {
    for (const l of this.lamps.values()) l.classList.remove('lit');
    const l = this.lamps.get(letter);
    if (!l) return;
    l.classList.add('lit');
    if (ms > 0) setTimeout(() => l.classList.remove('lit'), ms);
  }
  dark() {
    for (const l of this.lamps.values()) l.classList.remove('lit');
  }

  /** Draw cables for "AB CD …"; the half-plugged socket (while plugging) glows. */
  setPlugs(pairs: string, pending: string | null = null) {
    for (const [ch, s] of this.sockets) {
      s.classList.toggle('pending', ch === pending);
      s.classList.remove('plugged');
    }
    const list = pairs
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter(p => p.length === 2);
    // Layout positions inside the front panel (untransformed): the board is positioned, sockets are not.
    const board = this.board;
    const pos = (ch: string) => {
      const s = this.sockets.get(ch)!,
        hole = s.querySelector('.holes') as HTMLElement;
      return [
        board.offsetLeft + s.offsetLeft + s.offsetWidth / 2,
        board.offsetTop + s.offsetTop + hole.offsetTop + hole.offsetHeight / 2,
      ];
    };
    const paths = list.map((p, i) => {
      const [x1, y1] = pos(p[0]),
        [x2, y2] = pos(p[1]);
      this.sockets.get(p[0])!.classList.add('plugged');
      this.sockets.get(p[1])!.classList.add('plugged');
      const sag = 16 + Math.min(26, Math.abs(x2 - x1) * 0.07) + (i % 3) * 6;
      const d = `M${x1},${y1} C${x1},${Math.max(y1, y2) + sag} ${x2},${Math.max(y1, y2) + sag} ${x2},${y2}`;
      return `<path class="cable-shadow" d="${d}"/><path class="cable" d="${d}"/><circle class="plug" cx="${x1}" cy="${y1}" r="7"/><circle class="plug" cx="${x2}" cy="${y2}" r="7"/>`;
    });
    this.cables.innerHTML = `<defs><radialGradient id="emPlug" cx="40%" cy="35%"><stop offset="0" stop-color="#6b5a45"/><stop offset=".6" stop-color="#2b221a"/><stop offset="1" stop-color="#120e0a"/></radialGradient></defs>${paths.join('')}`;
  }

  /** While a Bombe runs: rotors whirl through positions. */
  spin(on: boolean) {
    clearInterval(this.spinTimer);
    this.root.classList.toggle('spinning', on);
    if (!on) return;
    this.spinTimer = window.setInterval(() => this.setWindows([0, 1, 2].map(() => Math.floor(Math.random() * 26))), 90);
  }
}
