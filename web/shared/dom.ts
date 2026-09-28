/** Small DOM and text helpers shared by every page. */

export const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** An element by id (the pages own their ids, so a missing one is a bug). */
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Escape text for innerHTML. */
export const esc = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Letters in five-letter groups, as on a signal form. */
export const groups = (s: string) => s.match(/.{1,5}/g)?.join(' ') ?? '';

/** Modulo 26, always non-negative. */
export const mod = (n: number) => ((n % 26) + 26) % 26;

/** Create an element with a class and inner HTML. */
export const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
