import { cosine, fromBytes, nearest, parseTagReply, tagList, tagPrompt, toBytes, withTag } from '../src/ai/text';

describe('assistant text helpers', () => {
  it('parses and tidies tags, skipping ones the item already has', () => {
    const reply = 'Sure! {"name": "cordless drill", "tags": ["Tools", "#power tool", "drill", "a very long tag with far too many words", "tools", 7]} hope that helps';
    expect(parseTagReply(reply, ['drill'])).toEqual({ name: 'Cordless drill', tags: ['tools', 'power tool'] });
    expect(parseTagReply('no json here')).toEqual({ name: null, tags: [] });
  });

  it('mentions the photo and known subjects in the prompt', () => {
    const p = tagPrompt({ name: 'Tent', hasPhoto: true, knownTags: ['camping', 'outdoors'] });
    expect(p).toMatch(/photo/);
    expect(p).toMatch(/camping, outdoors/);
  });

  it('stores vectors as bytes and ranks by cosine similarity', () => {
    const a = Float32Array.from([1, 0, 0]);
    expect([...fromBytes(toBytes(a))]).toEqual([1, 0, 0]);
    expect(cosine(a, Float32Array.from([2, 0, 0]))).toBeCloseTo(1);
    const vectors = new Map([
      ['saw', Float32Array.from([0.9, 0.1, 0])],
      ['passport', Float32Array.from([0, 0.2, 0.9])],
    ]);
    expect(nearest(Float32Array.from([1, 0, 0]), vectors, 0.5).map((r) => r.id)).toEqual(['saw']);
  });

  it('reads and extends the comma-separated subjects field', () => {
    expect(tagList(' tools,  camping ,, ')).toEqual(['tools', 'camping']);
    expect(withTag('', 'stove')).toBe('stove');
    expect(withTag('tools, Camping', 'camping')).toBe('tools, Camping');
    expect(withTag('tools,camping', 'gas')).toBe('tools, camping, gas');
  });
});
