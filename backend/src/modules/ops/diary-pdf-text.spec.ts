import { toWinAnsi, wrapLines } from './diary-pdf-text';

describe('diary-pdf-text (BE-11)', () => {
  describe('toWinAnsi', () => {
    it('preslovljava bosanska slova koja WinAnsi ne može kodirati', () => {
      expect(toWinAnsi('č ć đ Č Ć Đ')).toBe('c c d C C D');
    });

    it('ostavlja slova koja Windows-1252 ima (š, ž, Š, Ž, €, —, „” )', () => {
      expect(toWinAnsi('Šljunak — žž')).toBe('Šljunak — žž');
    });

    it('normalizuje prelome redova i tabove, a nepoznato zamjenjuje sa ?', () => {
      expect(toWinAnsi('a\r\nb\tc')).toBe('a\nb c');
      expect(toWinAnsi('кирилица')).toBe('?'.repeat(8));
    });

    it('ne pada na emoji niti na prazan string', () => {
      expect(toWinAnsi('')).toBe('');
      expect(toWinAnsi('ok 🚧')).toBe('ok ?');
    });
  });

  describe('wrapLines', () => {
    // font od 10 znakova: svaki znak je širok 10 (mjerač je determinističan)
    const measure = (text: string): number => text.length * 10;

    it('lomi po riječima i poštuje širinu', () => {
      expect(wrapLines('aaa bbb ccc', 70, measure)).toEqual(['aaa bbb', 'ccc']);
    });

    it('poštuje postojeće prelome redova, uključujući prazne redove', () => {
      expect(wrapLines('a\n\nb', 100, measure)).toEqual(['a', '', 'b']);
    });

    it('lomi riječ koja je šira od reda (ništa ne izlazi sa stranice)', () => {
      expect(wrapLines('abcdefghij', 40, measure)).toEqual([
        'abcd',
        'efgh',
        'ij',
      ]);
    });

    it('ne vraća redove sa vodećim/trailing razmacima', () => {
      const lines = wrapLines('  aaa   bbb  ', 70, measure);
      expect(lines).toEqual(['aaa bbb']);
    });
  });
});
