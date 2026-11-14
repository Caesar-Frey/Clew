jest.mock('react-native', () => ({ useColorScheme: () => 'light' }));

import { dark, light } from '../src/ui/theme';

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe('contrast (WCAG)', () => {
  it.each([
    ['light inkFaint on room', light.inkFaint, light.room],
    ['light inkFaint on card', light.inkFaint, light.card],
    ['light headRule on room', light.headRule, light.room],
    ['light inkSoft on room', light.inkSoft, light.room],
    ['dark inkFaint on room', dark.inkFaint, dark.room],
    ['dark headRule on room', dark.headRule, dark.room],
    ['dark badge text on stamp', '#1A100A', dark.stamp],
    ['light badge text on stamp', '#FFF4E6', light.stamp],
  ])('%s is at least 4.5:1 for text', (_, fg, bg) => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5));

  it.each([
    ['light tab icon on drawer face', light.brassLight, '#7A5034'],
    ['dark tab icon on drawer face', dark.brass, '#3A2618'],
    ['light switch off-track on card', light.inkFaint, light.card],
    ['dark switch off-track on card', dark.inkFaint, dark.card],
  ])('%s is at least 3:1 for graphics', (_, fg, bg) => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3));
});
