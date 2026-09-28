/**
 * Wehrmacht and Kriegsmarine Enigma components.
 *
 * Notch letters are the window letters at which a rotor carries its left
 * neighbour on the next key press (rotor I shows Q, then turns to R and
 * steps the middle rotor). Rotors VI–VIII have two notches.
 */
export interface RotorSpec {
  readonly wiring: string;
  readonly notches: string;
}

export const ROTORS: Readonly<Record<string, RotorSpec>> = {
  I: { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notches: 'Q' },
  II: { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notches: 'E' },
  III: { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notches: 'V' },
  IV: { wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB', notches: 'J' },
  V: { wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK', notches: 'Z' },
  VI: { wiring: 'JPGVOUMFYQBENHZRDKASXLICTW', notches: 'ZM' },
  VII: { wiring: 'NZJHGRCXMYSWBOUFAIVLPEKQDT', notches: 'ZM' },
  VIII: { wiring: 'FKQHTLXOCBJSPDZRAMEWNIUYGV', notches: 'ZM' },
};

/** M4 fourth ("greek") wheels. They sit left of the three stepping rotors and never turn. */
export const GREEK: Readonly<Record<string, string>> = {
  Beta: 'LEYJVCNIXWPBQMDRTAKZGFUHOS',
  Gamma: 'FSOKANUERHMBTIYCWLQPZXVGJD',
};

export const REFLECTORS: Readonly<Record<string, string>> = {
  A: 'EJMZALYXVBWFCRQUONTSPIKHGD',
  B: 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
  C: 'FVPJIAOYEDRZXWGCTKUQSBNMHL',
  'B-thin': 'ENKQAUYWJICOPBLMDXZVFTHRGS',
  'C-thin': 'RDOBJNTKVEHMLFCWZAXGYIPSUQ',
};

/** Rotor sets by machine: Heer/Luftwaffe Enigma I used I–V; the naval M3 and M4 used I–VIII. */
export const ROTOR_SETS = {
  I: ['I', 'II', 'III', 'IV', 'V'],
  M3: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'],
  M4: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'],
} as const;

export const A = 65;
export const idx = (ch: string): number => ch.charCodeAt(0) - A;
export const chr = (i: number): string => String.fromCharCode(A + i);
export const mod26 = (n: number): number => ((n % 26) + 26) % 26;
