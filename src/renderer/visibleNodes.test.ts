import { describe, expect, it } from 'vitest';
import { encodeVisibleNodes } from './visibleNodes';

describe('encodeVisibleNodes', () => {
  it('lays nodes out in level order and links each parent to its first drawn child', () => {
    const { texels, offsets } = encodeVisibleNodes([
      { path: '7', level: 1 },
      { path: '', level: 0 },
      { path: '0', level: 1 },
      { path: '73', level: 2 },
      { path: '70', level: 2 },
    ]);

    expect([...offsets.entries()]).toEqual([
      ['', 0],
      ['0', 1],
      ['7', 2],
      ['70', 3],
      ['73', 4],
    ]);
    expect([...texels.slice(0, 3)]).toEqual([0b10000001, 0, 1]);
    expect([...texels.slice(4, 7)]).toEqual([0, 0, 0]);
    expect([...texels.slice(8, 11)]).toEqual([0b00001001, 0, 1]);
  });

  it('leaves a node whose parent is not drawn as its own subtree root', () => {
    const { texels, offsets } = encodeVisibleNodes([
      { path: '', level: 0 },
      { path: '12', level: 2 },
    ]);

    expect(offsets.get('12')).toBe(1);
    expect(texels[0]).toBe(0);
  });
});
