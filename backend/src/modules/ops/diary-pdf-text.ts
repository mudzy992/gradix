/**
 * BE-11: priprema teksta za PDF dnevnik.
 *
 * `pdf-lib` sa standardnim (WinAnsi) fontovima **ne može** da kodira `č`, `ć`, `đ`
 * (`WinAnsi cannot encode "č"`), a `drawText` ne prelama redove. Prije ovoga je
 * generisanje PDF-a za dnevnik sa bh. slovima padalo na 500, a dug tekst je bio
 * odsječen na 110 znakova. Zato se tekst prije crtanja:
 *
 * 1. preslovljava u WinAnsi-sigurnu formu (`č`→`c`, `ć`→`c`, `đ`→`d`, ostalo → `?`),
 * 2. normalizuje (`\r\n` → `\n`, tab → razmak),
 * 3. lomi na redove po **stvarnoj širini** fonta.
 */

const WIN_ANSI_FOLD: Record<string, string> = {
  č: 'c',
  ć: 'c',
  đ: 'd',
  Č: 'C',
  Ć: 'C',
  Đ: 'D',
};

/** Znakovi iznad U+00FF koje Windows-1252 ipak ima (pdf-lib ih kodira). */
const CP1252_EXTRAS = new Set([
  '€', // 0x80
  '‚', // 0x82
  'ƒ', // 0x83
  '„', // 0x84
  '…', // 0x85
  '†', // 0x86
  '‡', // 0x87
  'ˆ', // 0x88
  '‰', // 0x89
  'Š', // 0x8A
  '‹', // 0x8B
  'Œ', // 0x8C
  'Ž', // 0x8E
  '\u2018', // 0x91 ‘
  '\u2019', // 0x92 ’
  '\u201c', // 0x93 “
  '\u201d', // 0x94 ”
  '•', // 0x95
  '–', // 0x96
  '—', // 0x97
  '˜', // 0x98
  '™', // 0x99
  'š', // 0x9A
  '›', // 0x9B
  'œ', // 0x9C
  'ž', // 0x9E
  'Ÿ', // 0x9F
]);

/** Tekst koji WinAnsi font može da kodira, sa sačuvanim prelomima redova. */
export function toWinAnsi(input: string): string {
  let out = '';
  for (const char of input.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
    const folded = WIN_ANSI_FOLD[char];
    if (folded) {
      out += folded;
      continue;
    }
    if (char === '\n') {
      out += '\n';
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || (code >= 0x20 && code <= 0x7e)) {
      out += char;
      continue;
    }
    if (code >= 0xa0 && code <= 0xff) {
      out += char;
      continue;
    }
    out += CP1252_EXTRAS.has(char) ? char : '?';
  }
  return out;
}

/**
 * Prelama tekst na redove tako da svaki red stane u `maxWidth` (mjereno fontom).
 * Poštuje postojeće `\n`. Riječ koja je šira od reda lomi se po znakovima, da
 * ništa ne “pobjegne” van stranice.
 */
export function wrapLines(
  input: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of input.split('\n')) {
    const words = paragraph.split(/ +/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = '';
      }
      if (measure(word) <= maxWidth) {
        current = word;
        continue;
      }
      let chunk = '';
      for (const char of word) {
        const next = chunk + char;
        if (measure(next) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk = next;
        }
      }
      current = chunk;
    }
    if (current) {
      lines.push(current);
    }
  }
  return lines;
}
