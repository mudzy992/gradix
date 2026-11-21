import { averagePercent, taskPercent } from './progress';

const tasks = (...statuses: string[]) => statuses.map((status) => ({ status }));

describe('taskPercent', () => {
  it('bez zadataka je 0', () => {
    expect(taskPercent([])).toBe(0);
    expect(taskPercent(tasks('CANCELLED'))).toBe(0);
  });

  it('računa procenat završenih, zaokruženo', () => {
    expect(taskPercent(tasks('COMPLETED'))).toBe(100);
    expect(taskPercent(tasks('COMPLETED', 'OPEN'))).toBe(50);
    expect(taskPercent(tasks('COMPLETED', 'OPEN', 'OPEN'))).toBe(33);
  });

  it('otkazani zadaci ne ulaze u imenilac', () => {
    expect(taskPercent(tasks('COMPLETED', 'CANCELLED'))).toBe(100);
    expect(taskPercent(tasks('COMPLETED', 'OPEN', 'CANCELLED'))).toBe(50);
  });
});

describe('averagePercent', () => {
  it('bez faza je 0', () => {
    expect(averagePercent([])).toBe(0);
  });

  it('prosjek faza, zaokružen', () => {
    expect(averagePercent([100, 0])).toBe(50);
    expect(averagePercent([100, 100, 0])).toBe(67);
  });
});
