/**
 * Where the project's files live. Found by walking up from this module to the
 * project's package.json, so the paths hold wherever the code runs from: the
 * repository, a test, or a Vercel Function (where the files ship beside the
 * function and the working directory is the project root).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findRoot(): string {
  for (let dir = import.meta.dir; ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === 'enigma-jev') return dir;
    if (dirname(dir) === dir) return process.cwd();
  }
}

export const ROOT = findRoot();
export const DATA = join(ROOT, 'data');
export const REPORTS = join(ROOT, 'reports');
