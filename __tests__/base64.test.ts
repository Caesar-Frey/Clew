import { base64ToBytes } from '../src/lib/base64';

it('decodes base64 like Node does', () => {
  for (const len of [0, 1, 2, 3, 4, 5, 100, 257]) {
    const bytes = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + len) & 255));
    expect(Buffer.from(base64ToBytes(bytes.toString('base64')))).toEqual(bytes);
  }
});
