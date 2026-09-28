/**
 * Operator habits Bletchley exploited: “cillies” (message keys a person finds
 * easy to type or remember) and the Herivel tip (start positions left close to
 * the ring settings just set). Used by the key sheet on the machine page and by
 * Figure 5 of the research page.
 */
import { A } from './dom.js';

/** The Enigma keyboard (QWERTZU), row by row. */
const ROWS = ['QWERTZUIO', 'ASDFGHJK', 'PYXCVBNML'];
/** Three-letter starts a cribber would try first; the video's BER→LIN and CIL among them. */
const WORDS: Record<string, string> = {
  BER: 'Berlin, and the next key is probably LIN',
  LIN: 'the end of BERLIN',
  LON: 'London',
  DON: 'the end of LONDON',
  CIL: 'Cillie, the girlfriend who gave cillies their name',
  HEI: 'Heil, or Heinz',
  ROM: 'Rome',
  WIE: 'Wien (Vienna)',
  PAR: 'Paris',
  EVA: 'a name',
  ANN: 'a name',
  ROS: 'Rosa',
  GRE: 'Gretel',
  KAT: 'Käthe',
  OKW: 'the High Command',
};

export interface Habit {
  readonly kind: 'cilly' | 'herivel' | 'csko';
  readonly title: string;
  readonly note: string;
}

const circ = (a: number, b: number) => {
  const d = Math.abs(a - b) % 26;
  return Math.min(d, 26 - d);
};

/** Why a three-letter setting would be among the first a Bletchley cribber tried, or null if it looks random. */
export function cilly(letters: string): Habit | null {
  const s = letters.toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) return null;
  const [a, b, c] = [...s].map(ch => A.indexOf(ch));
  if (a === b && b === c)
    return {
      kind: 'cilly',
      title: `${s} is a cilly`,
      note: 'Three of the same letter: the first thing a cribber tried.',
    };
  if ((b - a + 26) % 26 === 1 && (c - b + 26) % 26 === 1)
    return { kind: 'cilly', title: `${s} is a cilly`, note: 'An alphabet run: easy to type, easy to guess.' };
  if ((a - b + 26) % 26 === 1 && (b - c + 26) % 26 === 1)
    return { kind: 'cilly', title: `${s} is a cilly`, note: 'A backward alphabet run: easy to type, easy to guess.' };
  for (const row of ROWS)
    if (row.includes(s) || [...row].reverse().join('').includes(s))
      return {
        kind: 'cilly',
        title: `${s} is a cilly`,
        note: `Three neighbours on the QWERTZU keyboard (${row.slice(0, 3)}…).`,
      };
  if (WORDS[s]) return { kind: 'cilly', title: `${s} is a cilly`, note: `Not random: ${WORDS[s]}.` };
  return null;
}

/** Is every window within `near` letters of its ring setting? Herivel's lazy operator. */
export function herivel(positions: readonly number[], rings: readonly number[], near = 2): Habit | null {
  if (!positions.every((p, i) => circ(p, rings[i]) <= near)) return null;
  const pos = positions.map(p => A[p]).join(''),
    ring = rings.map(r => A[r]).join('');
  return {
    kind: 'herivel',
    title: 'Herivel tip',
    note: `The windows (${pos}) sit within ${near} letters of the rings (${ring}), as if the rotors barely moved after the rings were set. Across a morning's first messages that clustering gave Bletchley the rings.`,
  };
}

/**
 * Air Force key sheets never plugged a letter to its alphabetical neighbour. Bletchley
 * wired that rule into the Bombe as the consecutive stecker knock-out (Weinbaum 2025).
 */
export function consecutive(plugboard: string): Habit | null {
  const bad = plugboard.split(/\s+/).filter(p => p.length === 2 && Math.abs(p.charCodeAt(0) - p.charCodeAt(1)) === 1);
  if (!bad.length) return null;
  return {
    kind: 'csko',
    title: 'Not on a Luftwaffe sheet',
    note: `${bad.join(', ')} joins alphabet neighbours. Luftwaffe key sheets never did, and Bletchley's Bombes carried a switch, the consecutive stecker knock-out, that threw out any stop implying one.`,
  };
}
