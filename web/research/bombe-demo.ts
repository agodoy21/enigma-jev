/**
 * The worked example behind the research page's live figures: one weather
 * report from Biscay, enciphered on the project's own simulator, then attacked
 * the way Bletchley did it, by hand and by machine.
 *
 *   crib dragging   slide WETTERVORHERSAGEBISKAYA along the intercept and rule
 *                   out every place where a letter would meet itself
 *   the menu        crib and cipher letters joined by the positions that pair them;
 *                   a closed loop is a test no plugboard can hide
 *   test register   Turing's circuit: assume one plugboard partner, let the loops
 *                   propagate it, count the live wires (26 = contradiction)
 *
 * Everything here runs in the browser on the same scrambler tables the
 * software Bombe uses (src/break/engine.ts, src/break/register.ts), so the
 * figures are computed, not drawn.
 */
import { type EnigmaKey, encrypt } from '../../src/enigma/machine.js';
import { HEER, toOperatorText } from '../../src/lang/normalize.js';

/** A Biscay weather ship at six in the morning, the video's own example of a daily crib. */
export const DEMO_PROSE =
  'Um sechs Uhr. Wettervorhersage Biskaya: Wind Südwest Stärke vier, See drei, Sicht zwei Seemeilen, am Nachmittag Regen.';
export const DEMO_PLAIN = toOperatorText(DEMO_PROSE, { ...HEER, chToQ: false });
export const CRIB = 'WETTERVORHERSAGEBISKAYA';
export const CRIB_AT = DEMO_PLAIN.indexOf(CRIB);
export const DEMO_KEY: EnigmaKey = {
  reflector: 'B',
  rotors: ['II', 'V', 'III'],
  rings: [1, 20, 5],
  positions: [16, 4, 18],
  plugboard: 'AM BT CQ DH EJ FO GR IW KP LY',
};
export const DEMO_CIPHER = encrypt(DEMO_KEY, DEMO_PLAIN);

export * from '../../src/break/register.js';
