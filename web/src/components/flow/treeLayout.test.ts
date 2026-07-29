import { layoutTree, COL_W, ROW_H, type TreeItem } from './treeLayout';

/**
 *      A
 *     / \
 *    B   C
 *   / \   \
 *  D   E   F
 */
const FIXTURE: TreeItem[] = [
  { id: 'A', parentId: null },
  { id: 'B', parentId: 'A' },
  { id: 'D', parentId: 'B' },
  { id: 'E', parentId: 'B' },
  { id: 'C', parentId: 'A' },
  { id: 'F', parentId: 'C' },
];

describe('layoutTree', () => {
  const pos = layoutTree(FIXTURE);

  it('places every node at x = depth * COL_W', () => {
    expect(pos.A.x).toBe(0);
    expect(pos.B.x).toBe(COL_W);
    expect(pos.C.x).toBe(COL_W);
    expect(pos.D.x).toBe(2 * COL_W);
    expect(pos.E.x).toBe(2 * COL_W);
    expect(pos.F.x).toBe(2 * COL_W);
  });

  it('gives leaves non-overlapping y, one row apart in draw order', () => {
    expect([pos.D.y, pos.E.y, pos.F.y]).toEqual([0, ROW_H, 2 * ROW_H]);
    expect(new Set([pos.D.y, pos.E.y, pos.F.y]).size).toBe(3);
  });

  it('centres parents over their children', () => {
    expect(pos.B.y).toBe((pos.D.y + pos.E.y) / 2);
    expect(pos.C.y).toBe(pos.F.y);
    expect(pos.A.y).toBe((pos.B.y + pos.C.y) / 2);
  });

  it('treats an unknown parent as a root and survives a cycle', () => {
    const orphaned = layoutTree([
      { id: 'X', parentId: 'missing' },
      { id: 'Y', parentId: 'Z' },
      { id: 'Z', parentId: 'Y' },
    ]);
    expect(orphaned.X.x).toBe(0);
    expect(Object.keys(orphaned).sort()).toEqual(['X', 'Y', 'Z']);
  });
});
