import { createSearchIndex, editDistance, normalize, scoreToken } from '../src/search/fuzzy';

const items = ['Phillips screwdriver', 'Passport', 'Spare car keys', 'Christmas lights', 'Café cups', 'HDMI cable'];
const index = createSearchIndex(
  items.map((name, i) => ({
    value: name,
    rank: i,
    fields: [
      { text: name, weight: 1 },
      { text: name === 'Passport' ? 'Bedroom › Desk drawer' : 'Garage', weight: 0.6 },
    ],
  })),
);
const top = (q: string) => index.search(q)[0]?.value;

describe('fuzzy search', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalize('  Café-Cups! ')).toBe('cafe cups');
  });

  it('matches as you type', () => {
    expect(top('pa')).toBe('Passport');
    expect(top('scr')).toBe('Phillips screwdriver');
  });

  it('tolerates typos and dropped letters', () => {
    expect(top('screwdirver')).toBe('Phillips screwdriver');
    expect(top('pasport')).toBe('Passport');
    expect(top('xmas')).toBeUndefined();
    expect(top('chrstms')).toBe('Christmas lights');
  });

  it('needs every word to match, in any order', () => {
    expect(index.search('keys car').map((r) => r.value)).toEqual(['Spare car keys']);
    expect(index.search('keys passport')).toEqual([]);
  });

  it('finds things by where they are', () => {
    expect(top('desk drawer')).toBe('Passport');
    expect(index.search('garage').length).toBe(items.length - 1);
  });

  it('ranks name matches above place matches', () => {
    const idx = createSearchIndex([
      { value: 'in desk', fields: [{ text: 'Stapler', weight: 1 }, { text: 'Desk', weight: 0.6 }] },
      { value: 'named desk', fields: [{ text: 'Desk lamp', weight: 1 }, { text: 'Attic', weight: 0.6 }] },
    ]);
    expect(idx.search('desk')[0]!.value).toBe('named desk');
  });

  it('does not match unrelated short words', () => {
    expect(scoreToken('box', 'fox')).toBe(0);
    expect(editDistance('abcd', 'abdc', 2)).toBe(1);
  });
});
