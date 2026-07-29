import { describe, expect, it, vi } from 'vitest';
import { NodeCache } from './NodeCache';
import type { LoadedNode } from '../types';

function makeNode(key: string): LoadedNode {
  return { key, primitive: { destroyed: false }, pointCount: 1 };
}

describe('NodeCache', () => {
  it('returns undefined for a key that was never set', () => {
    const cache = new NodeCache(10, vi.fn());
    expect(cache.get('missing')).toBeUndefined();
  });

  it('returns the exact node that was set for a key', () => {
    const cache = new NodeCache(10, vi.fn());
    const node = makeNode('a');
    cache.set('a', node);
    expect(cache.get('a')).toBe(node);
  });

  it('evicts the least-recently-used entry once over budget', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(2, onEvict);
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');

    cache.set('a', a);
    cache.set('b', b);
    cache.set('c', c); // over budget by 1 -> evicts 'a' (oldest, untouched since insertion)

    expect(onEvict).toHaveBeenCalledExactlyOnceWith('a', a);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(b);
    expect(cache.get('c')).toBe(c);
  });

  it('get() bumps recency so a subsequent insert evicts a different entry', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(2, onEvict);
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');

    cache.set('a', a);
    cache.set('b', b);
    cache.get('a'); // 'a' is now more recently used than 'b'
    cache.set('c', c); // should evict 'b', not 'a'

    expect(onEvict).toHaveBeenCalledExactlyOnceWith('b', b);
    expect(cache.get('a')).toBe(a);
    expect(cache.get('c')).toBe(c);
  });

  it('set() on an existing key updates it and bumps recency', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(2, onEvict);
    const a = makeNode('a');
    const aUpdated = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');

    cache.set('a', a);
    cache.set('b', b);
    cache.set('a', aUpdated); // re-set 'a' -> most recently used
    cache.set('c', c); // should evict 'b', not 'a'

    expect(onEvict).toHaveBeenCalledExactlyOnceWith('b', b);
    expect(cache.get('a')).toBe(aUpdated);
  });

  it('never evicts a pinned node even if it is the least-recently-used one', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(2, onEvict);
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');

    cache.set('a', a);
    cache.pin(new Set(['a']));
    cache.set('b', b);
    cache.set('c', c); // 'a' is LRU but pinned -> 'b' evicted instead

    expect(onEvict).toHaveBeenCalledExactlyOnceWith('b', b);
    expect(cache.get('a')).toBe(a);
  });

  it('stays over budget without evicting anything when every entry is pinned', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(1, onEvict);
    const a = makeNode('a');
    const b = makeNode('b');

    cache.pin(new Set(['a', 'b']));
    cache.set('a', a);
    cache.set('b', b);

    expect(onEvict).not.toHaveBeenCalled();
    expect(cache.get('a')).toBe(a);
    expect(cache.get('b')).toBe(b);
  });

  it('pin() replaces the previously pinned set rather than adding to it', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(1, onEvict);
    const a = makeNode('a');
    const b = makeNode('b');

    cache.pin(new Set(['a']));
    cache.set('a', a);
    cache.pin(new Set(['b'])); // 'a' is no longer protected
    cache.set('b', b); // over budget -> 'a' is now evictable

    expect(onEvict).toHaveBeenCalledExactlyOnceWith('a', a);
  });

  it('destroy() evicts every remaining node via onEvict', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(10, onEvict);
    const a = makeNode('a');
    const b = makeNode('b');
    cache.set('a', a);
    cache.set('b', b);

    cache.destroy();

    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(onEvict).toHaveBeenCalledWith('a', a);
    expect(onEvict).toHaveBeenCalledWith('b', b);
  });

  it('clears the cache on destroy(), so get() afterward returns undefined', () => {
    const cache = new NodeCache(10, vi.fn());
    cache.set('a', makeNode('a'));

    cache.destroy();

    expect(cache.get('a')).toBeUndefined();
  });

  it('is idempotent — calling destroy() twice does not evict twice', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(10, onEvict);
    cache.set('a', makeNode('a'));

    cache.destroy();
    cache.destroy();

    expect(onEvict).toHaveBeenCalledTimes(1);
  });

  it('immediately evicts anything set() after destroy() instead of dropping it silently', () => {
    const onEvict = vi.fn();
    const cache = new NodeCache(10, onEvict);
    cache.destroy();

    const late = makeNode('late');
    cache.set('late', late);

    expect(onEvict).toHaveBeenCalledExactlyOnceWith('late', late);
    expect(cache.get('late')).toBeUndefined();
  });
});
