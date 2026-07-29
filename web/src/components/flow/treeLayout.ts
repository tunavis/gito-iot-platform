/**
 * Deterministic tree layout for FlowCanvas graphs.
 *
 *   x = depth * COL_W
 *   y = running leaf counter * ROW_H, with parents centred over their children
 *
 * ponytail: no dagre/elkjs. The graphs this repo draws are shallow strict trees
 * (org → site → group) with no crossing edges. Add a real layout engine only
 * when a genuine DAG exists — pulling one in for a tree never gets removed.
 *
 * Named `treeLayout`, not `useTreeLayout`: it is a pure function with no React
 * state. Callers wrap it in their own `useMemo` alongside node construction.
 */

export const COL_W = 260;
export const ROW_H = 68;

export interface TreeItem {
  id: string;
  /** null (or an id not present in `items`) makes this a root of the forest. */
  parentId: string | null;
}

export type Positions = Record<string, { x: number; y: number }>;

export function layoutTree(items: TreeItem[], colW = COL_W, rowH = ROW_H): Positions {
  const known = new Set(items.map((i) => i.id));
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];

  for (const { id, parentId } of items) {
    if (parentId && parentId !== id && known.has(parentId)) {
      const kids = childrenOf.get(parentId);
      if (kids) kids.push(id);
      else childrenOf.set(parentId, [id]);
    } else {
      roots.push(id);
    }
  }

  const pos: Positions = {};
  const seen = new Set<string>(); // guards against a malformed parent cycle hanging the tab
  let leaf = 0;

  const place = (id: string, depth: number): number => {
    if (seen.has(id)) return pos[id]?.y ?? 0;
    seen.add(id);

    const kids = childrenOf.get(id) ?? [];
    let y: number;
    if (kids.length === 0) {
      y = leaf++ * rowH;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    pos[id] = { x: depth * colW, y };
    return y;
  };

  roots.forEach((r) => place(r, 0));
  // Anything left is inside a parent cycle — malformed, but every item still
  // needs a position or React Flow renders a node at `undefined`.
  items.forEach((i) => {
    if (!(i.id in pos)) place(i.id, 0);
  });
  return pos;
}
