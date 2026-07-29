import type { LoadedNode } from '../types';

/**
 * LRU cache for loaded COPC nodes, bounded by node count rather than memory
 * (measuring actual per-point GPU usage isn't cheap enough to be worth it —
 * see the issue's "alternatives considered").
 *
 * Backed by a `Map`, which preserves insertion order: `get`/`set` bump an
 * entry by deleting and re-inserting it, so the least-recently-used entry is
 * always whichever key iterates first.
 *
 * Never destroys GPU resources itself — evicted (or, on destroy(), all
 * remaining) nodes are handed to `onEvict` so the caller decides how to tear
 * them down. Keeps this class free of any Cesium dependency.
 */
export class NodeCache {
  private readonly nodes = new Map<string, LoadedNode>();
  private pinned: ReadonlySet<string> = new Set();
  private destroyed = false;

  constructor(
    private readonly maxNodes: number,
    private readonly onEvict: (key: string, node: LoadedNode) => void,
  ) {}

  get(key: string): LoadedNode | undefined {
    const node = this.nodes.get(key);
    if (node === undefined) return undefined;
    this.nodes.delete(key);
    this.nodes.set(key, node);
    return node;
  }

  set(key: string, node: LoadedNode): void {
    if (this.destroyed) {
      // Nothing is tracking this node anymore; let the caller clean it up
      // rather than silently dropping (and leaking) it.
      this.onEvict(key, node);
      return;
    }
    this.nodes.delete(key);
    this.nodes.set(key, node);
    this._evictOverBudget();
  }

  /** Replaces the set of nodes currently protected from eviction. */
  pin(keys: Set<string>): void {
    this.pinned = keys;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [key, node] of this.nodes) {
      this.onEvict(key, node);
    }
    this.nodes.clear();
  }

  private _evictOverBudget(): void {
    if (this.nodes.size <= this.maxNodes) return;
    // Iterates in insertion (= least-recently-used-first) order. Deleting the
    // current key mid-iteration is well-defined and doesn't disturb keys the
    // iterator hasn't reached yet.
    for (const key of this.nodes.keys()) {
      if (this.nodes.size <= this.maxNodes) break;
      if (this.pinned.has(key)) continue;
      const node = this.nodes.get(key)!;
      this.nodes.delete(key);
      this.onEvict(key, node);
    }
  }
}
