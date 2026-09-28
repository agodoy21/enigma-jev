/**
 * Jev as the reader: is a trial decryption German, and which one is right?
 *
 * The state shows up to four distinct candidates, text only. The n-gram
 * scores are withheld so Jev's judgment is independent of the search that
 * produced them. A Bombe candidate carries its crib verbatim, so the state
 * says which letters were assumed and asks Jev to judge the rest. Two
 * question kinds:
 *   pick          choice among the candidates, or "none"
 *   readable_<k>  noul: the probability that candidate k is a correct decryption
 *
 * Jev's argmax is not a verdict on its own: over garbage its distribution is
 * flat and the top option can still be a wrong candidate. A pick is accepted
 * only when it is more likely than not on both questions (JEV_ACCEPT).
 */
import type { Candidate } from '../break/engine.js';
import type { JevModel } from './client.js';
import type { QuestionSet } from './schema.js';

export const JEV_ACCEPT = 0.5;

export interface Verdict {
  /** Index into the candidates passed in, or -1 for "none". */
  readonly pick: number;
  /** The pick, when P(pick) and its P(correct) both reach JEV_ACCEPT; otherwise -1. */
  readonly accepted: number;
  readonly pickProbability: number;
  readonly noneProbability: number;
  /** P(correct) per candidate. */
  readonly readable: number[];
  readonly latencyMs: number;
}

const LABELS = ['A', 'B', 'C', 'D'];
const SHOWN = 240;

/** Keep candidates that differ in most letters (near-duplicates add nothing for the reader). */
export function distinct(cands: Candidate[], max = 4): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cands) {
    if (out.length >= max) break;
    const dup = out.some(o => {
      let same = 0;
      for (let i = 0; i < c.plaintext.length; i++) if (o.plaintext[i] === c.plaintext[i]) same++;
      return same > 0.6 * c.plaintext.length;
    });
    if (!dup) out.push(c);
  }
  return out;
}

export interface JudgeOptions {
  /**
   * Live demonstrations: the plaintext language the codebreaker chose. When it is not German the
   * state asks for coherent text in that language instead of German military traffic. The
   * backtests never set this, so their wording (and results) are unchanged.
   */
  readonly language?: 'de' | 'en' | 'es';
}

const LANG_NAME = { de: 'German', en: 'English', es: 'Spanish' } as const;

export function judgeState(cipherText: string, cands: Candidate[], opts: JudgeOptions = {}): string {
  const lang = opts.language;
  const head =
    lang && lang !== 'de'
      ? [
          `Task: judge trial decryptions of one Enigma message sent in a live demonstration. The sender wrote in ${LANG_NAME[lang]}.`,
          `A correct decryption reads as coherent ${LANG_NAME[lang]} text in Enigma operator form throughout: no spaces, letters only, X for a full stop, accents dropped (for example Ñ keyed as N), numbers spelled out. Everyday words and names are fine; it does not have to be military.`,
          'A wrong key gives letter salad. A nearly right key (one wrong ring or plug) gives readable words with regular stretches of salad; that is not a correct decryption.',
        ]
      : [
          'Task: judge trial decryptions of one intercepted German Enigma message.',
          'A correct decryption reads as German military plaintext in operator form throughout: no spaces, X for a full stop and often between words, J between words in naval traffic, Q for CH in army traffic, numbers spelled out (ZWO for zwei), abbreviations and place names. Historical messages can contain a few garbled letters from transmission errors.',
          'A wrong key gives letter salad. A nearly right key (one wrong ring or plug) gives German with regular stretches of salad; that is not a correct decryption.',
        ];
  return [
    ...head,
    `Ciphertext (${cipherText.length} letters): ${cipherText.slice(0, SHOWN)}${cipherText.length > SHOWN ? '…' : ''}`,
    ...cands.map((c, k) => {
      const crib = /^bombe (\w+)@(\d+)/.exec(c.via);
      const note = crib
        ? ` (letters ${Number(crib[2]) + 1}–${Number(crib[2]) + crib[1].length} were assumed as a crib, ${crib[1]}, so they read correctly by construction; judge the rest)`
        : '';
      return `Candidate ${LABELS[k]}${note}: ${c.plaintext.slice(0, SHOWN)}${c.plaintext.length > SHOWN ? '…' : ''}`;
    }),
  ].join('\n');
}

export function judgeQuestions(n: number): QuestionSet {
  const criteria: Record<string, string> = {};
  for (let k = 0; k < n; k++) criteria[LABELS[k]] = `Candidate ${LABELS[k]} is the correct decryption.`;
  criteria.none = 'None of the candidates is a correct decryption.';
  const qs: Record<string, QuestionSet[string]> = {
    pick: { type: 'choice', instructions: 'Which candidate is the correct decryption of the ciphertext?', criteria },
  };
  for (let k = 0; k < n; k++) {
    qs[`readable_${LABELS[k]}`] = {
      type: 'noul',
      instructions: `Probability that candidate ${LABELS[k]} is a correct decryption: German plaintext in operator form throughout, allowing only a few garbled letters.`,
    };
  }
  return qs;
}

export async function judge(
  jev: JevModel,
  cipherText: string,
  cands: Candidate[],
  opts: JudgeOptions = {},
): Promise<Verdict> {
  const shown = cands.slice(0, 4);
  if (!shown.length)
    return { pick: -1, accepted: -1, pickProbability: 0, noneProbability: 1, readable: [], latencyMs: 0 };
  const res = await jev.evaluate(judgeState(cipherText, shown, opts), judgeQuestions(shown.length));
  const a = res.answers.answers;
  const pick = a.pick;
  if (pick.type !== 'choice' || !pick.probabilities) throw new Error('Jev pick answer malformed');
  const readable = shown.map((_, k) => {
    const r = a[`readable_${LABELS[k]}`];
    return r?.type === 'noul' ? r.noul : NaN;
  });
  const idx = pick.choice === 'none' ? -1 : LABELS.indexOf(pick.choice);
  const pickProbability = pick.probabilities[pick.choice] ?? 0;
  const accepted = idx >= 0 && pickProbability >= JEV_ACCEPT && readable[idx] >= JEV_ACCEPT ? idx : -1;
  return {
    pick: idx,
    accepted,
    pickProbability,
    noneProbability: pick.probabilities.none ?? 0,
    readable,
    latencyMs: res.latencyMs,
  };
}
