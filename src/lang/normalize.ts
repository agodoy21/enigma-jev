/**
 * German prose → the letters an Enigma operator would key.
 *
 * Operators had 26 letters and no space. A full stop became X, a colon XX,
 * a comma often Y or nothing, and the Heer wrote Q for CH. Numbers were
 * spelled out (ZWO for zwei, so it could not be misheard as DREI).
 */
export interface OperatorStyle {
  /** Letter between words, or '' to run words together. */
  readonly wordSeparator: '' | 'X' | 'J';
  /** Replace CH with Q (Heer practice). */
  readonly chToQ: boolean;
}

export const RUN_TOGETHER: OperatorStyle = { wordSeparator: '', chToQ: false };
export const HEER: OperatorStyle = { wordSeparator: '', chToQ: true };

export function toOperatorText(prose: string, style: OperatorStyle = RUN_TOGETHER): string {
  let t = prose
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE')
    .replace(/ß/g, 'SS')
    // Other accents (ñ, á, é, ç…) are keyed as the plain letter, as any operator would.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bZWEI/g, 'ZWO')
    .replace(/:/g, ' XX ')
    .replace(/[.!?;]/g, ' X ')
    .replace(/,/g, ' ')
    .replace(/[-/]/g, ' ');
  if (style.chToQ) t = t.replace(/CH/g, 'Q');
  const words = t.split(/[^A-Z]+/).filter(Boolean);
  const out = words.join(style.wordSeparator);
  // A stop at the very end reads as a trailing X either way.
  return out.replace(/X+$/, 'X').replace(/(XX)X+/g, '$1');
}

/** Paragraph-split file content, ignoring comment lines. */
export function paragraphs(file: string): string[] {
  return file
    .split(/\n\s*\n/)
    .map(p =>
      p
        .split('\n')
        .filter(l => !l.trim().startsWith('#'))
        .join(' ')
        .trim(),
    )
    .filter(Boolean);
}
