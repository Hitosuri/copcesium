import type { LoadedNode } from '../types';

/**
 * LRU cache for loaded COPC nodes, bounded by node count rather than memory
 * (measuring actual per-point GPU usage isn't cheap enough to be worth it —
 * see the issue's "alternatives considered").
 *
 * Backed by a `Map`, which preserves insertion order: `get`/`set`/`pin` bump
 * an entry by deleting and re-inserting it, so the least-recently-used entry
 * is always whichever key iterates first. `pin()` is what keeps that order
 * meaningful in practice — see its doc comment.
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

  /** Reads a node without bumping its LRU recency, for hot per-frame lookups. */
  peek(key: string): LoadedNode | undefined {
    return this.nodes.get(key);
  }

  get size(): number {
    return this.nodes.size;
  }

  set(key: string, node: LoadedNode): void {
    if (this.destroyed) {
      // Nothing is tracking this node anymore; let the caller clean it up
      // rather than silently dropping (and leaking) it.
      this.onEvict(key, node);
      return;
    }
    // Overwriting an existing key must tear the old node down through onEvict —
    // a plain delete would drop it from the map while its GPU resources leak.
    // Skip when the same object is re-set (a pure recency bump).
    const prev = this.nodes.get(key);
    if (prev !== undefined && prev !== node) {
      this.onEvict(key, prev);
    }
    this.nodes.delete(key);
    this.nodes.set(key, node);
    this._evictOverBudget();
  }

  /**
   * Replaces the set of nodes currently protected from eviction, and marks
   * those nodes as used.
   *
   * The caller passes exactly the set that is on screen this pass, which is
   * the only signal of use the cache gets: the per-frame visibility path
   * reads through `peek()` and deliberately doesn't bump recency, so without
   * this the backing Map would never leave insertion order and eviction
   * would be FIFO by load time — systematically evicting the shallow
   * ancestors first, since they load first and are exactly what a zoom-out
   * needs back.
   *
   * That makes the eviction order least-recently-*selected*, at the LoD
   * pass's `debounceMs` granularity, rather than strict LRU. Nodes selected
   * in the same pass are equally recent; their relative order just follows
   * `keys`.
   */
  pin(keys: Set<string>): void {
    this.pinned = keys;
    // get() re-inserts to refresh recency; the node itself isn't needed here.
    for (const key of keys) this.get(key);
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
