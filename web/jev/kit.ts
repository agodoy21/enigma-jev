/**
 * The Jev paper's toolkit: values bound into the prose from the report JSON,
 * and a small SVG chart kit (scales, axes, legends, tables, hover tips).
 */
import { esc } from '../shared/dom.js';

export { esc };
export const $ = (id: string) => document.getElementById(id) as HTMLElement;
/**
 * Report JSON as read from reports/. Its shape is fixed by the scripts that
 * write it (src/analysis/jev-eval.ts, analysis/judges.py); the page reads it
 * by path and renders "–" for anything missing, so it is left untyped here.
 */
// biome-ignore lint/suspicious/noExplicitAny: report JSON, see above
export type A = any;

// ─────────────────────────── values in the text ───────────────────────────
export function lookup(root: A, path: string): unknown {
  const parts = path.split('|');
  let cur: A = root,
    parent: A = null;
  for (const p of parts) {
    if (p.startsWith('+')) return Number(cur) + Number(parent?.[p.slice(1)]);
    parent = cur;
    cur = cur?.[p];
  }
  return cur;
}
export function fmt(v: unknown, f: string): string {
  if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) return '–';
  const n = Number(v);
  switch (f) {
    case 'int':
      return Math.round(n).toLocaleString('en-GB');
    case 'pct':
      return `${Math.round(n * 100)}%`;
    case 'pct1':
      return `${(n * 100).toFixed(1)}%`;
    case 'ci3':
    case 'ci4': {
      const [a, b] = v as number[];
      const d = f === 'ci3' ? 3 : 4;
      return `${a.toFixed(d)}–${b.toFixed(d)}`;
    }
    case 'cipct': {
      const [a, b] = v as number[];
      return `${(a * 100).toFixed(1)}–${(b * 100).toFixed(1)}%`;
    }
    case 'date':
      return new Date(String(v)).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    default:
      return /^\d$/.test(f) ? n.toFixed(Number(f)) : String(v);
  }
}
export function bind(data: A) {
  for (const el of document.querySelectorAll<HTMLElement>('.v[data-v]'))
    el.textContent = fmt(lookup(data, el.dataset.v!), el.dataset.f ?? '');
}

// ─────────────────────────── chart kit ───────────────────────────
export const S = { jev: 'var(--s-jev)', ngram: 'var(--s-ngram)', base: 'var(--s-base)' };
export const tip = $('tip');
document.addEventListener('mouseover', e => {
  const t = (e.target as Element).closest('[data-tip]') as SVGElement | HTMLElement | null;
  if (!t) {
    tip.classList.remove('on');
    return;
  }
  tip.innerHTML = t.getAttribute('data-tip')!;
  tip.classList.add('on');
  const r = t.getBoundingClientRect(),
    w = tip.offsetWidth,
    h = tip.offsetHeight;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.top - h - 10 < 8 ? r.bottom + 10 : r.top - h - 10}px`;
});
document.addEventListener('scroll', () => tip.classList.remove('on'), { passive: true });

export const lin = (d0: number, d1: number, r0: number, r1: number) => (v: number) =>
  r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
/** Deterministic jitter in [-1, 1] from an index. */
export const jit = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};
export const legend = (items: Array<{ label: string; color: string; dash?: boolean; shape?: string }>) =>
  `<div class="legend">${items.map(i => `<span class="lg"><svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${i.color}" stroke-width="2.5" ${i.dash ? 'stroke-dasharray="4 3"' : ''}/></svg>${esc(i.label)}</span>`).join('')}</div>`;
export function axisX(
  x: (v: number) => number,
  y0: number,
  ticks: number[],
  label: string,
  f = (v: number) => String(v),
) {
  return (
    ticks
      .map(
        t =>
          `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${y0}" y2="${y0 + 4}"/><text class="tick" x="${x(t)}" y="${y0 + 16}" text-anchor="middle">${f(t)}</text>`,
      )
      .join('') +
    `<text class="axl" x="${(x(ticks[0]) + x(ticks.at(-1)!)) / 2}" y="${y0 + 32}" text-anchor="middle">${label}</text>`
  );
}
export function axisY(
  y: (v: number) => number,
  x0: number,
  ticks: number[],
  label: string,
  x1: number,
  f = (v: number) => String(v),
) {
  return (
    ticks
      .map(
        t =>
          `<line class="grid" x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${x0 - 6}" y="${y(t) + 4}" text-anchor="end">${f(t)}</text>`,
      )
      .join('') +
    `<text class="axl" transform="translate(${x0 - 36} ${(y(ticks[0]) + y(ticks.at(-1)!)) / 2}) rotate(-90)" text-anchor="middle">${label}</text>`
  );
}
export const table = (head: string[], rows: Array<Array<string | number>>, numericFrom = 1) =>
  `<div class="tablewrap"><table class="atable"><thead><tr>${head.map((h, i) => `<th${i >= numericFrom ? ' class="fig"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i >= numericFrom ? ' class="fig"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '–');
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
