/**
 * When a live break may declare success: the evidence rules the web page
 * applies on top of the search. Pure functions, so they are tested directly.
 *
 * The backtest tiers (./tiers.ts) use Jev's decision rule alone; the page adds
 * guards learned from live use, where messages can be short, and in any
 * language. Each constant carries the observation that set it.
 */
import type { Verdict } from '../jev/judge.js';
import type { Lang } from '../lang/ngrams.js';
import type { CandidateView } from '../web/events.js';
import { KNOWN_CRIB } from './tiers.js';

/** Without Jev, a Bombe or climb result must read this German (outside its crib) to end the search. */
export const STRICT = 0.55;
/**
 * A verdict needs evidence: at least this many letters outside the assumed crib. When the crib is
 * (nearly) the whole message, any key that reproduces it "reads as German", which proves nothing.
 */
export const MIN_FREE = 12;
/**
 * German breaks need two judges to agree: Jev's acceptance and a letter-statistics floor. The floor
 * rejects none of the 76 correct decryptions in the evaluation set (lowest 0.437) but stops letter
 * salad that Jev passes at the margin (a live test: P(correct) 0.51 on garbage scoring 0.37).
 */
export const GERMAN_FLOOR = 0.42;

/** Letters of the message outside the crib a Bombe candidate assumed. */
export function freeLetters(c: Pick<CandidateView, 'via'>, letters: number): number {
  const m = /^bombe (\w+)@\d+/.exec(c.via);
  return letters - (m ? m[1].length : 0);
}

export interface Judged {
  /** Index of the accepted candidate, or −1. */
  accepted: number;
  verdict: Verdict | null;
  thin?: boolean;
  disagree?: number;
  decidedBy?: 'jev' | 'stats';
}

/**
 * German traffic: take the judge's answer, then refuse it if too little text lies beyond the crib,
 * or if the letter statistics disagree with an acceptance.
 */
export function checkGerman(judged: Judged, cands: CandidateView[], letters: number): Judged {
  const k = judged.accepted;
  if (k >= 0 && freeLetters(cands[k], letters) < MIN_FREE) return { ...judged, accepted: -1, thin: true };
  if (k >= 0 && cands[k].germanness < GERMAN_FLOOR) return { ...judged, accepted: -1, disagree: cands[k].germanness };
  return { ...judged, decidedBy: judged.verdict ? 'jev' : 'stats' };
}

/**
 * English or Spanish: the language's own letter statistics decide, with the same evidence floor.
 * Jev was evaluated on German and read run-together Spanish poorly (a perfect decryption at 8%),
 * so its verdict is kept as advice only.
 */
export function decideByStats(cands: CandidateView[], letters: number, advice: Verdict | null): Judged {
  const best = cands.reduce((b, c, i) => (c.germanness > cands[b].germanness ? i : b), 0);
  const ok = cands[best].germanness >= STRICT && freeLetters(cands[best], letters) >= MIN_FREE;
  return { accepted: ok ? best : -1, verdict: advice, decidedBy: 'stats' };
}

export interface PlannedCrib {
  text: string;
  at: number;
  source: string;
}

/** Parse the sender's crib: TEXT or TEXT@position. */
export function parseCrib(raw: string | undefined, clean: (s: string) => string): PlannedCrib | null {
  if (!raw?.trim()) return null;
  const [text, at] = raw.split('@');
  return { text: clean(text), at: at ? Number(at) : 0, source: 'your crib' };
}

/**
 * The order in which cribs go to the Bombe: the sender's own first, then the ranked list (German only,
 * since the list is German traffic phrases). Each is cut to KNOWN_CRIB letters, since longer menus gain
 * little and make a middle-rotor step inside the crib likelier, and dropped if it would leave fewer
 * than MIN_FREE letters to judge the result by.
 */
export function planCribs(
  user: PlannedCrib | null,
  ranked: { order: { text: string }[]; source: 'jev' | 'static' },
  lang: Lang,
  letters: number,
  maxCribs = 10,
): PlannedCrib[] {
  const listed = (lang === 'de' ? ranked.order : []).slice(0, maxCribs).map((c, i) => ({
    text: c.text,
    at: 0,
    source: ranked.source === 'jev' ? `Jev's #${i + 1}` : `list #${i + 1}`,
  }));
  return [...(user ? [user] : []), ...listed]
    .map(c => ({ ...c, text: c.text.slice(0, KNOWN_CRIB) }))
    .filter(c => letters - c.text.length >= MIN_FREE);
}

/** The one-line outcome shown under the break. */
export function outcome(chosen: number, lang: Lang, usedJev: boolean, letters: number): string {
  const label = 'ABC'[chosen];
  if (chosen >= 0) {
    if (lang !== 'de') return `${lang === 'en' ? 'English' : 'Spanish'} letter statistics accept candidate ${label}`;
    return usedJev ? `Jev accepts candidate ${label}` : 'n-gram verdict: reads as German';
  }
  if (letters < MIN_FREE + 8)
    return `Too short to prove: ${letters} letters leave too little text beyond any crib to judge`;
  return usedJev ? 'Jev accepted no candidate' : 'n-gram verdict: nothing reads as German';
}
