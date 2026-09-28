/**
 * Reading aids shared by the long-form pages: contents rail with the current
 * section highlighted, progress bar, heading anchors, reading-time line, and
 * citations linked to the reference list with a hover preview.
 * The page provides #annex (the article), #toc, #tocToggle, #readProgress, #paperMeta and #refs.
 */
import { esc } from './dom.js';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export function initReader(kind = 'Research note') {
  const paper = $('annex');
  // ─────────────────────────── contents, anchors, progress ───────────────────────────
  const slug = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const heads = [...paper.querySelectorAll('section h3, section h4')] as HTMLElement[];
  const toc = $('toc');
  const list = document.createElement('ol');
  for (const h of heads) {
    h.id ||= slug(h.textContent ?? '');
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.className = 'anchor';
    a.setAttribute('aria-label', `Link to ${h.textContent}`);
    a.textContent = '#';
    h.append(a);
    const li = document.createElement('li');
    li.className = h.tagName === 'H3' ? 'lvl1' : 'lvl2';
    li.innerHTML = `<a href="#${h.id}">${esc((h.firstChild?.textContent ?? '').trim())}</a>`;
    list.append(li);
  }
  toc.append(list);
  const tocLinks = new Map(
    [...toc.querySelectorAll('a')].map(a => [a.getAttribute('href')!.slice(1), a as HTMLElement]),
  );

  // The current section is the last heading above the top third of the viewport.
  function spy() {
    const line = window.innerHeight * 0.3;
    let current = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top <= line) current = h;
    for (const [id, a] of tocLinks) a.classList.toggle('on', id === current.id);
    const doc = document.documentElement;
    const done = doc.scrollTop / Math.max(1, doc.scrollHeight - doc.clientHeight);
    $('readProgress').style.transform = `scaleX(${Math.min(1, Math.max(0, done))})`;
  }
  document.addEventListener('scroll', spy, { passive: true });
  window.addEventListener('resize', spy);
  spy();

  const toggle = $('tocToggle');
  toggle.onclick = () => {
    const open = toc.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  };
  toc.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('a')) {
      toc.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Reading time and scope, from the text itself.
  const words = (paper.textContent ?? '').trim().split(/\s+/).length;
  const refs = paper.querySelectorAll('#refs li').length;
  $('paperMeta').textContent =
    `${kind} · ${Math.round(words / 230)} min read · ${heads.filter(h => h.tagName === 'H4').length} sections · ${refs} references`;

  // ─────────────────────────── citations ───────────────────────────
  // "(Kahn 1991; Bauer 2007)" becomes links to the reference list, with the full entry on hover.
  const refItems = [...paper.querySelectorAll('#refs li')] as HTMLElement[];
  const refKey = new Map<string, HTMLElement>();
  for (const li of refItems) {
    const t = li.textContent ?? '';
    const m = /^(.*?)\((?:eds?\.?\)\s*\()?(c\.\d{4}|\d{4}|n\.d\.)\)/.exec(t);
    if (!m) continue;
    // Harvard in-text form: one, two or three surnames; "et al." from four, or when the entry says so.
    const parts = m[1]
      .split(/,\s*|\s+and\s+/)
      .map(x => x.trim())
      .filter(Boolean);
    const etAl = /et al\./.test(m[1]);
    const names = parts.filter(x => !/^([A-Z]\.\s?)+$/.test(x) && !/et al\./.test(x) && !/^\(?eds?\.?\)?$/.test(x));
    const lead = parts[0]?.replace(/\s*et al\..*/, '') ?? '';
    const who =
      etAl || names.length > 3
        ? `${lead} et al.`
        : names.length === 3
          ? `${names[0]}, ${names[1]} and ${names[2]}`
          : names.join(' and ');
    const key = `${who} ${m[2]}`;
    li.id = `ref-${slug(key)}`;
    refKey.set(key, li);
  }
  const citeRe =
    refKey.size === 0
      ? /$^/g
      : new RegExp(
          `(${[...refKey.keys()]
            .sort((a, b) => b.length - a.length)
            .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|')})`,
          'g',
        );
  const pop = document.createElement('div');
  pop.className = 'cite-pop';
  pop.setAttribute('role', 'tooltip');
  document.body.append(pop);

  const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT, {
    acceptNode: n =>
      n.parentElement?.closest('#refs, code, a, h3, h4, figure') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const node of texts) {
    const t = node.data;
    if (!citeRe.test(t)) continue;
    citeRe.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of t.matchAll(citeRe)) {
      frag.append(t.slice(last, m.index));
      const a = document.createElement('a');
      const li = refKey.get(m[0])!;
      a.href = `#${li.id}`;
      a.className = 'cite';
      a.textContent = m[0];
      a.dataset.ref = li.id;
      frag.append(a);
      last = m.index! + m[0].length;
    }
    frag.append(t.slice(last));
    node.replaceWith(frag);
  }
  function showPop(a: HTMLElement) {
    const li = document.getElementById(a.dataset.ref!);
    if (!li) return;
    pop.innerHTML = li.innerHTML;
    pop.classList.add('on');
    const r = a.getBoundingClientRect(),
      w = Math.min(420, window.innerWidth - 24);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12)}px`;
    const below = r.bottom + 10 + pop.offsetHeight < window.innerHeight;
    pop.style.top = `${below ? r.bottom + 10 : r.top - pop.offsetHeight - 10}px`;
  }
  const hidePop = () => pop.classList.remove('on');
  paper.addEventListener('mouseover', e => {
    const a = (e.target as HTMLElement).closest('a.cite') as HTMLElement | null;
    if (a) showPop(a);
  });
  paper.addEventListener('mouseout', e => {
    if ((e.target as HTMLElement).closest('a.cite')) hidePop();
  });
  paper.addEventListener('focusin', e => {
    const a = (e.target as HTMLElement).closest('a.cite') as HTMLElement | null;
    if (a) showPop(a);
  });
  paper.addEventListener('focusout', hidePop);
  document.addEventListener('scroll', hidePop, { passive: true });
  paper.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('a.cite') as HTMLElement | null;
    if (!a) return;
    const li = document.getElementById(a.dataset.ref!);
    if (li) {
      li.classList.remove('flash');
      void li.offsetWidth;
      li.classList.add('flash');
    }
  });
}
