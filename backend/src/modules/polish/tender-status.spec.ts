jest.mock('../../../generated/client', () => ({ TenderStatus: {} }), {
  virtual: true,
});

import { assertTenderTransition } from './tender-status';

describe('tender-status (BE-15)', () => {
  it('dozvoljava DRAFT → SUBMITTED → WON', () => {
    expect(() => assertTenderTransition('DRAFT', 'SUBMITTED')).not.toThrow();
    expect(() => assertTenderTransition('SUBMITTED', 'WON')).not.toThrow();
    expect(() => assertTenderTransition('SUBMITTED', 'LOST')).not.toThrow();
  });

  it('dozvoljava odustajanje iz DRAFT i SUBMITTED', () => {
    expect(() => assertTenderTransition('DRAFT', 'WITHDRAWN')).not.toThrow();
    expect(() =>
      assertTenderTransition('SUBMITTED', 'WITHDRAWN'),
    ).not.toThrow();
  });

  it('isti status je no-op (idempotentan PATCH)', () => {
    expect(() => assertTenderTransition('WON', 'WON')).not.toThrow();
  });

  it('terminalni statusi se ne mijenjaju', () => {
    for (const from of ['WON', 'LOST', 'WITHDRAWN'] as const) {
      expect(() => assertTenderTransition(from, 'DRAFT')).toThrow(
        /Invalid tender status/,
      );
      expect(() => assertTenderTransition(from, 'SUBMITTED')).toThrow(
        /Invalid tender status/,
      );
    }
  });

  it('preskakanje koraka je zabranjeno (DRAFT → WON)', () => {
    expect(() => assertTenderTransition('DRAFT', 'WON')).toThrow(
      /Invalid tender status/,
    );
  });
});
