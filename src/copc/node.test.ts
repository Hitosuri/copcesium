import { describe, expect, it } from 'vitest';
import { getChildKeys, getDepth, getParentKey } from './node';

describe('getParentKey', () => {
  it('returns null for the root key', () => {
    expect(getParentKey('0-0-0-0')).toBeNull();
  });

  it('returns the parent key one level up', () => {
    expect(getParentKey('1-1-1-1')).toBe('0-0-0-0');
    expect(getParentKey('1-0-0-0')).toBe('0-0-0-0');
  });

  it('rounds each coordinate down (integer division by 2), not just strips the low bit', () => {
    expect(getParentKey('2-3-3-3')).toBe('1-1-1-1');
  });

  it('is the exact inverse of getChildKeys for every child', () => {
    const parent = '2-3-5-1';
    for (const child of getChildKeys(parent)) {
      expect(getParentKey(child)).toBe(parent);
    }
  });
});

describe('getDepth / getChildKeys (existing coverage sanity check)', () => {
  it('getDepth extracts the leading depth component', () => {
    expect(getDepth('3-1-2-4')).toBe(3);
  });

  it('getChildKeys returns 8 keys one level deeper', () => {
    expect(getChildKeys('0-0-0-0')).toHaveLength(8);
    expect(getChildKeys('0-0-0-0')).toContain('1-1-1-1');
  });
});
