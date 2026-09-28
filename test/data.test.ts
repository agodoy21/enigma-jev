import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clean, encrypt, parseSetting } from '../src/enigma/machine.js';
import { paragraphs, RUN_TOGETHER, toOperatorText } from '../src/lang/normalize.js';

const DATA = join(import.meta.dir, '..', 'data');

interface Entry {
  id: string;
  sources: string[];
  reflector: string;
  rotors: string[];
  rings: number[];
  messageKey: string;
  plugboard?: string;
  ciphertext: string;
  plaintext: string;
}

const entries = JSON.parse(readFileSync(join(DATA, 'historical', 'messages.json'), 'utf8')) as Entry[];

describe('data', () => {
  test('every historical entry, scored or not, decrypts with its key and cites a source', () => {
    for (const m of entries) {
      const key = {
        reflector: m.reflector,
        rotors: m.rotors,
        rings: parseSetting(m.rings.join(' ')),
        positions: parseSetting(m.messageKey),
        plugboard: m.plugboard ?? '',
      };
      expect(m.sources.length).toBeGreaterThan(0);
      expect(encrypt(key, clean(m.ciphertext))).toBe(clean(m.plaintext));
    }
    expect(new Set(entries.map(m => m.id)).size).toBe(entries.length);
  });

  test('the synthetic plaintexts are held out of the German corpus', () => {
    const dir = join(DATA, 'corpus');
    const corpus = readdirSync(dir)
      .filter(f => f.endsWith('.txt'))
      .map(f => toOperatorText(readFileSync(join(dir, f), 'utf8'), RUN_TOGETHER))
      .join('');
    const synthetic = paragraphs(readFileSync(join(DATA, 'synthetic', 'plaintexts.txt'), 'utf8'));
    expect(synthetic.length).toBe(16);
    for (const p of synthetic) {
      const s = toOperatorText(p.slice(p.indexOf(':') + 1), RUN_TOGETHER);
      // No 30-letter stretch of a held-out message may appear in the training text.
      for (let i = 0; i + 30 <= s.length; i += 10) expect(corpus.includes(s.slice(i, i + 30))).toBe(false);
    }
  });
});
