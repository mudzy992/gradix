import { readUniqueTarget } from './prisma-errors';

describe('readUniqueTarget', () => {
  it('čita niz imena polja (Prisma 7 / adapter)', () => {
    expect(readUniqueTarget({ target: ['email'] })).toContain('email');
    expect(
      readUniqueTarget({ target: ['companyId', 'employeeCode'] }),
    ).toContain('employeeCode');
  });

  it('čita string (ime ograničenja)', () => {
    expect(readUniqueTarget({ target: 'User_email_key' })).toContain('email');
  });

  it('fallback: i kad `target` nema, gleda cijeli meta', () => {
    expect(readUniqueTarget({ field_name: 'slug' })).toContain('slug');
  });

  it('nepoznat/odsutan meta ne baca', () => {
    expect(readUniqueTarget(undefined)).toBe('');
    expect(readUniqueTarget(null)).toBe('');
    expect(readUniqueTarget('email')).toBe('');
    expect(readUniqueTarget({})).toBe('{}');
  });

  it('ne pravi razliku između velikih i malih slova polja', () => {
    // pozivaoci porede lowercase imena; meta dolazi iz baze kao ime kolone
    expect(readUniqueTarget({ target: ['EMAIL'] }).toLowerCase()).toContain(
      'email',
    );
  });
});
