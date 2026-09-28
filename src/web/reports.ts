/**
 * Reports on disk, served to the papers. Every analysis writes JSON to
 * reports/; the pages read it on each request, so a rerun shows at once.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORTS } from '../paths.js';

export { REPORTS };

/** A GET handler that serves reports/<file>, or says which command writes it. */
export function reportRoute(file: string, command: string) {
  return () => {
    const f = join(REPORTS, file);
    return existsSync(f)
      ? new Response(readFileSync(f), { headers: { 'Content-Type': 'application/json' } })
      : Response.json({ error: `no ${file} yet: run ${command}` }, { status: 404 });
  };
}

/**
 * The backtest runs the papers cite: the newest run that includes the historical
 * set ("main") and the newest synthetic-only run on another seed ("holdout").
 */
export function latestBacktests() {
  if (!existsSync(REPORTS)) return { main: null, holdout: null };
  const runs = readdirSync(REPORTS)
    .filter(f => /^backtest-.*\.json$/.test(f))
    .sort()
    .reverse()
    .map(f => {
      try {
        const r = JSON.parse(readFileSync(join(REPORTS, f), 'utf8'));
        return { file: f, meta: r.meta, summaries: r.summaries };
      } catch {
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => !!r?.meta?.jev);
  return {
    main: runs.find(r => r.summaries.historical) ?? null,
    holdout: runs.find(r => !r.summaries.historical && r.meta.seed !== 1941) ?? null,
  };
}
