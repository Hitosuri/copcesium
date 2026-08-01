import { describe, expect, it } from 'vitest';
import { getChildKeys, getDepth, getParentKey, isAncestorOf } from './node';

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

describe('isAncestorOf', () => {
  it('recognises a direct parent', () => {
    expect(isAncestorOf('0-0-0-0', '1-1-1-1')).toBe(true);
    for (const child of getChildKeys('2-3-5-1')) {
      expect(isAncestorOf('2-3-5-1', child)).toBe(true);
    }
  });

  it('recognises an ancestor several levels up', () => {
    expect(isAncestorOf('0-0-0-0', '3-7-7-7')).toBe(true);
    expect(isAncestorOf('1-1-1-1', '3-7-7-7')).toBe(true);
    expect(isAncestorOf('1-1-1-1', '3-4-4-4')).toBe(true);
  });

  it('rejects a node that is outside the ancestor cell at the same depth', () => {
    expect(isAncestorOf('1-0-0-0', '3-7-7-7')).toBe(false);
    expect(isAncestorOf('1-1-1-1', '3-3-4-4')).toBe(false); // x falls in the sibling cell
  });

  it('rejects siblings, self, and the reverse direction (proper ancestors only)', () => {
    expect(isAncestorOf('1-0-0-0', '1-1-1-1')).toBe(false);
    expect(isAncestorOf('1-1-1-1', '1-1-1-1')).toBe(false);
    expect(isAncestorOf('3-7-7-7', '0-0-0-0')).toBe(false);
  });

  it('agrees with walking up via getParentKey', () => {
    let key = '4-9-13-2';
    while (true) {
      const parent = getParentKey(key);
      if (!parent) break;
      expect(isAncestorOf(parent, '4-9-13-2')).toBe(true);
      key = parent;
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
