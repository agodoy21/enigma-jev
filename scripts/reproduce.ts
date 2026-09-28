/**
 * Reproduce the numbers in the papers.
 *
 *   bun run reproduce                  offline: tests, the Bombe validation, and the
 *                                      Jev analyses from the committed or local data
 *   bun run reproduce --backtests      also rerun both backtests (needs TYPESAFE_API_KEY,
 *                                      makes Jev calls, takes a while)
 *   bun run reproduce --experiments    also rerun the Jev reliability experiments (about 58 calls)
 *
 * Each step prints where its output goes and which part of the papers reads it.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadJevKey } from '../src/jev/client.js';

const ROOT = join(import.meta.dir, '..');
const flags = new Set(process.argv.slice(2));
const LOG = join(process.env.ENIGMA_JEV_HOME ?? join(homedir(), '.enigma-jev'), 'jev-calls.jsonl');
const PYTHON = join(ROOT, '.venv', 'bin', 'python');

interface Step {
  title: string;
  cmd: string[];
  feeds: string;
  when?: () => string | null; // a reason to skip, or null to run
}

const steps: Step[] = [
  {
    title: 'Unit and regression tests',
    cmd: ['bun', 'test'],
    feeds: 'the test suite; every historical key decrypts exactly',
  },
  {
    title: 'Backtest, main run (seed 1941)',
    cmd: ['bun', 'run', 'src/cli.ts', 'backtest', 'all', '--seed', '1941'],
    feeds: 'reports/backtest-*.json → research C.3, Jev §7 Table 3',
    when: () =>
      !flags.has('--backtests') ? 'pass --backtests to rerun' : loadJevKey() ? null : 'needs TYPESAFE_API_KEY',
  },
  {
    title: 'Backtest, holdout (seed 2024)',
    cmd: ['bun', 'run', 'src/cli.ts', 'backtest', 'synthetic', '--seed', '2024'],
    feeds: 'reports/backtest-*.json → research C.3 (holdout table)',
    when: () =>
      !flags.has('--backtests') ? 'pass --backtests to rerun' : loadJevKey() ? null : 'needs TYPESAFE_API_KEY',
  },
  {
    title: 'Jev reliability experiments',
    cmd: ['bun', 'run', 'src/analysis/jev-experiments.ts'],
    feeds: 'reports/jev-experiments.json → Jev §4.6',
    when: () =>
      !flags.has('--experiments') ? 'pass --experiments to rerun' : loadJevKey() ? null : 'needs TYPESAFE_API_KEY',
  },
  {
    title: 'Jev analysis from the audit log',
    cmd: ['bun', 'run', 'src/analysis/jev-eval.ts'],
    feeds: 'reports/jev-analysis.json, reports/judge-dataset.json → Jev §§1–7',
    when: () => (existsSync(LOG) ? null : `no audit log at ${LOG}; the committed reports stand`),
  },
  {
    title: 'Bombe stop counts against Weinbaum (2025)',
    cmd: ['bun', 'run', 'src/analysis/bombe-stops.ts'],
    feeds: 'reports/bombe-stops.json → research B.5, Table B1',
  },
  {
    title: 'Jev against n-gram judges and XGBoost',
    cmd: [PYTHON, 'analysis/judges.py'],
    feeds: 'reports/judge-comparison.json → Jev §4.8, Tables 4–5, Figure 9',
    when: () =>
      existsSync(PYTHON) ? null : 'python3 -m venv .venv && .venv/bin/pip install -r analysis/requirements.txt',
  },
];

let failed = 0;
for (const s of steps) {
  const skip = s.when?.();
  if (skip) {
    console.log(`\n◦ ${s.title}: skipped (${skip})`);
    continue;
  }
  console.log(`\n▶ ${s.title}\n  ${s.cmd.join(' ')}\n  → ${s.feeds}`);
  const t = performance.now();
  const p = Bun.spawnSync(s.cmd, { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
  const secs = ((performance.now() - t) / 1000).toFixed(1);
  if (p.exitCode === 0) console.log(`✓ ${s.title} (${secs}s)`);
  else {
    failed++;
    console.log(`✗ ${s.title} failed (exit ${p.exitCode})`);
  }
}
console.log(
  failed
    ? `\n${failed} step(s) failed.`
    : '\nDone. Restart `bun run web` if it was running; the pages read reports/ live.',
);
process.exit(failed ? 1 : 0);
