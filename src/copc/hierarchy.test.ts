import { describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const loadHierarchyPage = vi.fn();

vi.mock('copc', () => ({
  Copc: {
    create: (...args: unknown[]) => create(...args),
    loadHierarchyPage: (...args: unknown[]) => loadHierarchyPage(...args),
  },
}));

const { loadCopcHierarchy } = await import('./hierarchy');

describe('loadCopcHierarchy', () => {
  it('extracts root center/half size from the cube and computes max depth', async () => {
    create.mockResolvedValueOnce({
      info: {
        cube: [-100, -50, 0, 100, 150, 40],
        rootHierarchyPage: { pageOffset: 0, pageLength: 100 },
      },
      wkt: undefined,
    });
    loadHierarchyPage.mockResolvedValueOnce({
      nodes: {
        '0-0-0-0': { pointCount: 10, pointDataOffset: 0, pointDataLength: 1 },
        '1-0-0-0': { pointCount: 5, pointDataOffset: 1, pointDataLength: 1 },
        '2-1-1-1': { pointCount: 3, pointDataOffset: 2, pointDataLength: 1 },
      },
      pages: {},
    });

    const result = await loadCopcHierarchy('https://example.com/sample.copc.laz');

    expect(result.rootCenter).toEqual({ x: 0, y: 50, z: 20 });
    expect(result.rootHalfSize).toBe(100);
    expect(result.maxDepth).toBe(2);
    expect(Object.keys(result.nodes)).toHaveLength(3);
  });

  it('raises a descriptive error when the COPC header cannot be read', async () => {
    create.mockRejectedValueOnce(new Error('Invalid header: too short'));

    await expect(loadCopcHierarchy('https://example.com/broken.copc.laz')).rejects.toThrow(
      /Failed to read the COPC header/,
    );
  });

  it('propagates unrelated errors unchanged', async () => {
    create.mockRejectedValueOnce(new Error('network error'));

    await expect(loadCopcHierarchy('https://example.com/sample.copc.laz')).rejects.toThrow('network error');
  });
});
