/**
 * Cribs: probable plaintext, and Jev's choice among them.
 *
 * The list is the kind Hut 6 and Hut 8 kept: addressees, report headings,
 * abbreviations and routine phrases in operator form. Jev is asked which of
 * them most likely opens a given message; the Bombe then tries them in that
 * order. The static order below (general before specific) is the baseline
 * that Jev's ranking is scored against in the backtest.
 */
import { cribFits } from '../break/bombe.js';
import type { JevModel } from './client.js';
import type { ChoiceQuestion } from './schema.js';

export type Service = 'Heer' | 'Luftwaffe' | 'Kriegsmarine';

export interface Crib {
  readonly text: string;
  readonly meaning: string;
  readonly services: readonly Service[];
}

const ALL: Service[] = ['Heer', 'Luftwaffe', 'Kriegsmarine'];
const LAND: Service[] = ['Heer', 'Luftwaffe'];

export const CRIBS: readonly Crib[] = [
  { text: 'KEINEBESONDERENEREIGNISSE', meaning: 'nothing to report (routine daily message)', services: ALL },
  { text: 'OBERKOMMANDODERWEHRMACHT', meaning: 'Wehrmacht high command (addressee or sender)', services: ALL },
  { text: 'WETTERVORHERSAGE', meaning: 'weather forecast (heading)', services: ALL },
  { text: 'WETTERMELDUNG', meaning: 'weather report (heading)', services: ALL },
  { text: 'WETTERBERICHT', meaning: 'weather report (heading)', services: ALL },
  { text: 'FUNKSPRUCH', meaning: 'radio message (heading)', services: ALL },
  { text: 'SPRUCHNUMMER', meaning: 'message number (heading)', services: ALL },
  { text: 'FUEHRERHAUPTQUARTIER', meaning: "Führer's headquarters (addressee or sender)", services: ALL },
  { text: 'BEFEHL', meaning: 'order (heading)', services: ALL },
  { text: 'FEINDLIQE', meaning: '"enemy …" opening a contact or sighting report, CH written Q', services: LAND },
  { text: 'AUFKLAERUNG', meaning: 'reconnaissance (heading or unit)', services: LAND },
  { text: 'AUFKLX', meaning: 'abbreviation Aufkl. (reconnaissance unit) with X for the full stop', services: LAND },
  { text: 'TAGESMELDUNG', meaning: 'daily report (heading)', services: LAND },
  { text: 'LAGEBERICHT', meaning: 'situation report (heading)', services: LAND },
  { text: 'ARMEEOBERKOMMANDO', meaning: 'army headquarters (addressee or sender)', services: ['Heer'] },
  { text: 'GENERALKOMMANDO', meaning: 'corps headquarters (addressee or sender)', services: ['Heer'] },
  { text: 'HEERESGRUPPE', meaning: 'army group (addressee or sender)', services: ['Heer'] },
  { text: 'LUFTFLOTTE', meaning: 'air fleet (addressee or sender)', services: ['Luftwaffe'] },
  { text: 'FLIEGERKORPS', meaning: 'air corps (addressee or sender)', services: ['Luftwaffe'] },
  { text: 'VONVON', meaning: 'naval opening "from … from", the sender repeated', services: ['Kriegsmarine'] },
  { text: 'ANBEFEHLSHABERDERUBOOTE', meaning: 'to the U-boat command', services: ['Kriegsmarine'] },
  { text: 'BEFEHLSHABERDERUBOOTE', meaning: 'U-boat command (sender)', services: ['Kriegsmarine'] },
  { text: 'GELEITZUG', meaning: 'convoy (sighting report)', services: ['Kriegsmarine'] },
  { text: 'STANDORT', meaning: 'position (position report)', services: ['Kriegsmarine'] },
  { text: 'KRKR', meaning: 'naval priority prefix (Kr = urgent)', services: ['Kriegsmarine'] },
];

/** Cribs of the right service that can open this ciphertext (no letter enciphered to itself). */
export function openingCribs(cipherText: string, service?: Service): Crib[] {
  return CRIBS.filter(c => (!service || c.services.includes(service)) && cribFits(cipherText, c.text, 0));
}

export interface CribRanking {
  readonly order: Crib[];
  /** Jev's probability for each crib, and for "none of these". */
  readonly probabilities: Record<string, number>;
  readonly none: number;
  readonly source: 'jev' | 'static';
  readonly latencyMs?: number;
}

export interface MessageContext {
  readonly service?: Service;
  readonly date?: string;
  readonly machine: string;
}

export function cribState(cipherText: string, ctx: MessageContext, fitting: Crib[], ruledOut: Crib[]): string {
  return [
    'Task: choose a crib (probable plaintext) for an intercepted German Enigma message, the way Bletchley Park analysts did before running a Bombe.',
    `Traffic: ${ctx.service ?? 'service unknown'}, ${ctx.machine === 'M4' ? 'four-rotor naval Enigma M4' : ctx.machine === 'M3' ? 'naval Enigma M3' : 'Enigma I'}, ${ctx.date ?? 'date unknown'}. The message body is ${cipherText.length} letters long.`,
    'Operator conventions: no spaces; X marks a full stop and often separates words; the army writes Q for CH; numbers are spelled out (ZWO for zwei); naval operators separate words with J and often open with the sender or addressee.',
    `Crib dragging (an Enigma never enciphers a letter to itself) leaves these phrases possible at the very start of this message: ${fitting.map(c => c.text).join(', ') || 'none'}.`,
    ruledOut.length ? `Ruled out at the start by a letter clash: ${ruledOut.map(c => c.text).join(', ')}.` : '',
    `First ciphertext letters: ${cipherText.slice(0, 40)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function cribQuestion(fitting: Crib[]): ChoiceQuestion {
  const criteria: Record<string, string> = {};
  fitting.forEach((c, i) => {
    criteria[`c${i}`] = `The plaintext begins with ${c.text}: ${c.meaning}.`;
  });
  criteria.none = 'The plaintext begins with none of the listed phrases.';
  return {
    type: 'choice',
    instructions:
      'Which phrase most likely begins the plaintext of this message? Judge from the traffic type, the length and the usual structure of such messages.',
    criteria,
  };
}

export async function rankCribs(cipherText: string, ctx: MessageContext, jev: JevModel | null): Promise<CribRanking> {
  const service = ctx.service;
  const candidates = CRIBS.filter(c => !service || c.services.includes(service));
  const fitting = candidates.filter(c => cribFits(cipherText, c.text, 0));
  const ruledOut = candidates.filter(c => !fitting.includes(c));
  if (!jev || fitting.length === 0) return { order: fitting, probabilities: {}, none: 0, source: 'static' };
  const res = await jev.evaluate(cribState(cipherText, ctx, fitting, ruledOut), { crib: cribQuestion(fitting) });
  const a = res.answers.answers.crib;
  if (a.type !== 'choice' || !a.probabilities) return { order: fitting, probabilities: {}, none: 0, source: 'static' };
  const probabilities: Record<string, number> = {};
  fitting.forEach((c, i) => {
    probabilities[c.text] = a.probabilities![`c${i}`] ?? 0;
  });
  // Stable sort: ties keep the static order.
  const order = fitting
    .map((c, i) => ({ c, i }))
    .sort((x, y) => probabilities[y.c.text] - probabilities[x.c.text] || x.i - y.i)
    .map(x => x.c);
  return { order, probabilities, none: a.probabilities.none ?? 0, source: 'jev', latencyMs: res.latencyMs };
}
