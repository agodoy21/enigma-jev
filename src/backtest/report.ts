/** Backtest output: a terminal line per case, a summary table, and JSON + Markdown files. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaseRow, Summary } from './run.js';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

export function caseLine(r: CaseRow): string {
  const cells = r.tiers.map(t => {
    const mark = t.broken ? '✓' : '·';
    const jev = t.jev ? (t.jev.pick === -2 ? ' jev:err' : ` jev:${t.jev.right ? 'right' : 'WRONG'}`) : '';
    return `${t.tier} ${mark} ${pct(t.accuracy)} ${secs(t.ms)}${jev}`;
  });
  const crib = r.trueCrib ? ` crib ${r.trueCrib} jev#${r.cribRankJev ?? '–'} static#${r.cribRankStatic ?? '–'}` : '';
  return `${r.id.padEnd(28)} ${r.machine.padEnd(2)} ${String(r.letters).padStart(3)}L ${r.plugs}p │ ${cells.join(' │ ')}${crib}${r.error ? ` ERROR ${r.error}` : ''}`;
}

export function summaryText(s: Summary, kind: string): string {
  const lines = [
    `\n${kind}`,
    'tier     broken      jev verdict right   (argmax only)   n-gram verdict right   jev brier   median time',
  ];
  for (const [tier, t] of Object.entries(s.byTier)) {
    const jev = t.jevJudged ? `${t.jevRight}/${t.jevJudged} (${pct(t.jevRight / t.jevJudged)})` : '–';
    const ng = tier === 'verify' ? '–' : `${t.ngramRight}/${t.cases} (${pct(t.ngramRight / t.cases)})`;
    const arg = t.jevJudged ? `${t.jevArgmaxRight}/${t.jevJudged}` : '–';
    lines.push(
      `${tier.padEnd(8)} ${`${t.broken}/${t.cases}`.padEnd(11)} ${jev.padEnd(19)} ${arg.padEnd(15)} ${ng.padEnd(22)} ${t.brier === null ? '–' : t.brier.toFixed(3)}       ${secs(t.medianMs)}`,
    );
  }
  const c = s.crib;
  lines.push(
    `cribs: ${c.withTrueCrib} case(s) open with a listed crib · mean rank jev ${c.jevMeanRank?.toFixed(2) ?? '–'} vs static ${c.staticMeanRank?.toFixed(2) ?? '–'} · top-1 jev ${c.jevTop1} vs static ${c.staticTop1}`,
  );
  return lines.join('\n');
}

export function writeReport(
  dir: string,
  rows: CaseRow[],
  summaries: Record<string, Summary>,
  meta: Record<string, unknown>,
): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const json = join(dir, `backtest-${stamp}.json`),
    md = join(dir, `backtest-${stamp}.md`);
  writeFileSync(json, JSON.stringify({ meta, summaries, rows }, null, 2));
  const out: string[] = [`# Backtest ${stamp}`, '', '```', JSON.stringify(meta, null, 2), '```', ''];
  for (const [kind, s] of Object.entries(summaries)) out.push('```', summaryText(s, kind).trim(), '```', '');
  out.push(
    '| case | machine | letters | plugs | tier | broken | accuracy | time | Jev verdict | cribs tried | note |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const r of rows)
    for (const t of r.tiers) {
      const jev = t.jev
        ? t.jev.pick === -2
          ? 'error'
          : `${t.jev.right ? 'right' : 'wrong'} (argmax ${t.jev.pick < 0 ? 'none' : 'ABCD'[t.jev.pick]} ${t.jev.pickProbability.toFixed(2)}, accepted ${t.jev.accepted < 0 ? 'none' : 'ABCD'[t.jev.accepted]})`
        : '';
      out.push(
        `| ${r.id} | ${r.machine} | ${r.letters} | ${r.plugs} | ${t.tier} | ${t.broken ? '✓' : ''} | ${pct(t.accuracy)} | ${secs(t.ms)} | ${jev} | ${(t.cribsTried ?? []).join(', ')} | ${[t.note, r.notes].filter(Boolean).join('; ')} |`,
      );
    }
  writeFileSync(md, out.join('\n') + '\n');
  return { json, md };
}
