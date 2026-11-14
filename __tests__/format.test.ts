import { callNumber, dueState } from '../src/lib/format';
import { replaceSummary } from '../src/lib/format';

describe('callNumber', () => {
  it('abbreviates the last three places', () => {
    expect(callNumber(['House', 'Garage', 'Blue box'])).toBe('HOU·GAR·BB');
    expect(callNumber(['Home', 'Café', 'Top shelf', 'Tin'])).toBe('CAF·TS·TIN');
    expect(callNumber([])).toBe('UNSHELVED');
  });
});

describe('dueState', () => {
  const now = 1_000_000_000;
  it('classifies due dates', () => {
    expect(dueState(null, now)).toBe('none');
    expect(dueState(now - 1, now)).toBe('overdue');
    expect(dueState(now + 86_400_000, now)).toBe('soon');
    expect(dueState(now + 10 * 86_400_000, now)).toBe('ok');
  });
});

describe('replaceSummary', () => {
  it('counts places even when there are no things', () => {
    expect(replaceSummary(0, 2)).toBe('The 2 places');
    expect(replaceSummary(1, 1)).toBe('The 1 thing and 1 place');
    expect(replaceSummary(0, 0)).toBe('Everything');
  });
});
