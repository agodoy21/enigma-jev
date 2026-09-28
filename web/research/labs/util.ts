/** Helpers shared by the research page's live figures. */
export { A } from '../../shared/dom.js';

export const $ = (id: string) => document.getElementById(id);
export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-GB');
export function sci(v: number): string {
  if (v < 1e7) return fmtInt(v);
  const e = Math.floor(Math.log10(v)),
    m = v / 10 ** e;
  return `${m.toFixed(2)} × 10<sup>${e}</sup>`;
}
export const fact = (n: number) => {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};
export const plugboards = (p: number) => fact(26) / (fact(26 - 2 * p) * fact(p) * 2 ** p);
/** The next paint, or 50 ms if the page is not painting (a background pane), whichever comes first. */
export const nextFrame = () =>
  new Promise<void>(r => {
    const t = setTimeout(r, 50);
    requestAnimationFrame(() => {
      clearTimeout(t);
      r();
    });
  });
