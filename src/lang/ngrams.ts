/**
 * German letter statistics for scoring trial decryptions.
 *
 * Trained on data/corpus/*.txt, keyed four ways (words run together; X
 * between words; X between words with Q for CH; J between words, the naval habit) so the model accepts every
 * common operator habit. Trigram log-probabilities are interpolated with
 * bigram and unigram estimates, so a short corpus still gives every trigram
 * a finite score.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from '../paths.js';
import { paragraphs, toOperatorText } from './normalize.js';

export interface LanguageModel {
  /** log P(c | a b), indexed (a*26 + b)*26 + c. */
  readonly tri: Float64Array;
  /** log P(b | a), indexed a*26 + b. */
  readonly bi: Float64Array;
  readonly uni: Float64Array;
  /** Mean trigram log-prob per letter for German text and for uniform random letters. */
  readonly germanMean: number;
  readonly randomMean: number;
  readonly trainingLetters: number;
}

const CORPUS_DIR = join(DATA, 'corpus');

export function trainingText(dir = CORPUS_DIR): string[] {
  const texts: string[] = [];
  for (const f of readdirSync(dir)
    .filter(n => n.endsWith('.txt'))
    .sort()) {
    for (const p of paragraphs(readFileSync(join(dir, f), 'utf8'))) {
      texts.push(toOperatorText(p, { wordSeparator: '', chToQ: false }));
      texts.push(toOperatorText(p, { wordSeparator: 'X', chToQ: false }));
      texts.push(toOperatorText(p, { wordSeparator: 'X', chToQ: true }));
      texts.push(toOperatorText(p, { wordSeparator: 'J', chToQ: false }));
    }
  }
  return texts;
}

export function buildModel(texts: string[] = trainingText()): LanguageModel {
  const c1 = new Float64Array(26),
    c2 = new Float64Array(676),
    c3 = new Float64Array(17576);
  let letters = 0;
  for (const t of texts) {
    const v = Array.from(t, ch => ch.charCodeAt(0) - 65);
    for (let i = 0; i < v.length; i++) {
      c1[v[i]]++;
      letters++;
      if (i >= 1) c2[v[i - 1] * 26 + v[i]]++;
      if (i >= 2) c3[(v[i - 2] * 26 + v[i - 1]) * 26 + v[i]]++;
    }
  }
  const uniP = new Float64Array(26);
  for (let i = 0; i < 26; i++) uniP[i] = (c1[i] + 0.5) / (letters + 13);
  const biP = new Float64Array(676);
  for (let a = 0; a < 26; a++) {
    let row = 0;
    for (let b = 0; b < 26; b++) row += c2[a * 26 + b];
    for (let b = 0; b < 26; b++) biP[a * 26 + b] = row ? 0.8 * (c2[a * 26 + b] / row) + 0.2 * uniP[b] : uniP[b];
  }
  const tri = new Float64Array(17576);
  for (let ab = 0; ab < 676; ab++) {
    let row = 0;
    for (let c = 0; c < 26; c++) row += c3[ab * 26 + c];
    const b = ab % 26;
    for (let c = 0; c < 26; c++) {
      const p3 = row ? c3[ab * 26 + c] / row : 0;
      const w3 = row ? row / (row + 4) : 0; // trust a trigram row in proportion to how often its context was seen
      tri[ab * 26 + c] = Math.log(w3 * p3 + (1 - w3) * (0.85 * biP[b * 26 + c] + 0.15 * uniP[c]));
    }
  }
  const bi = biP.map(Math.log),
    uni = uniP.map(Math.log);
  let randomMean = 0;
  for (let i = 0; i < 17576; i++) randomMean += tri[i];
  randomMean /= 17576;
  const partial = { tri, bi, uni, germanMean: 0, randomMean, trainingLetters: letters };
  let sum = 0,
    n = 0;
  for (const t of texts) {
    sum += scoreText(partial, t) * (t.length - 2);
    n += Math.max(0, t.length - 2);
  }
  return { ...partial, germanMean: sum / n };
}

/** Mean trigram log-probability per scored letter. */
export function scoreText(m: Pick<LanguageModel, 'tri'>, text: string): number {
  if (text.length < 3) return -Infinity;
  let s = 0;
  let a = text.charCodeAt(0) - 65,
    b = text.charCodeAt(1) - 65;
  for (let i = 2; i < text.length; i++) {
    const c = text.charCodeAt(i) - 65;
    s += m.tri[(a * 26 + b) * 26 + c];
    a = b;
    b = c;
  }
  return s / (text.length - 2);
}

/** 0 ≈ random letters, 1 ≈ typical German in operator form. Can leave [0,1] slightly. */
export function germanness(m: LanguageModel, text: string): number {
  return (scoreText(m, text) - m.randomMean) / (m.germanMean - m.randomMean);
}

let cached: LanguageModel | null = null;
export function german(): LanguageModel {
  if (!cached) cached = buildModel();
  return cached;
}

/**
 * Plaintext languages for live demonstrations. Bletchley only ever faced German; a
 * visitor may write in English or Spanish, and the Bombe's stop ranking and plugboard
 * climb must score candidates in the language of the message.
 */
export type Lang = 'de' | 'en' | 'es';
const models = new Map<Lang, LanguageModel>();
export function languageModel(lang: Lang = 'de'): LanguageModel {
  if (lang === 'de') return german();
  let m = models.get(lang);
  if (!m) {
    m = buildModel(trainingText(join(DATA, `corpus-${lang}`)));
    models.set(lang, m);
  }
  return m;
}
