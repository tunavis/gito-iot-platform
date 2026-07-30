import type { Node, XYPosition } from '@xyflow/react';
import { applyPinned } from './useGraphNodes';

const node = (id: string, x: number, y: number): Node => ({
  id,
  position: { x, y },
  data: {},
});

/** The layout the graph builder produces on each rebuild. */
const LAID_OUT = [node('a', 0, 0), node('b', 0, 68), node('add', 0, 136)];

describe('applyPinned', () => {
  it('returns the laid-out nodes untouched when nothing has been dragged', () => {
    const result = applyPinned(LAID_OUT, new Map());
    expect(result).toBe(LAID_OUT); // same reference — no needless rerender
  });

  it('keeps a dragged node at its dropped position', () => {
    const pinned = new Map<string, XYPosition>([['b', { x: 400, y: 240 }]]);
    const result = applyPinned(LAID_OUT, pinned);

    expect(result.find((n) => n.id === 'b')!.position).toEqual({ x: 400, y: 240 });
  });

  it('still reflows the nodes the user never touched', () => {
    // The regression this guards: freezing *every* position meant an added
    // condition landed on top of whatever previously sat in its slot.
    const pinned = new Map<string, XYPosition>([['b', { x: 400, y: 240 }]]);
    const grown = [...LAID_OUT, node('c', 0, 204)];
    const result = applyPinned(grown, pinned);

    expect(result.find((n) => n.id === 'a')!.position).toEqual({ x: 0, y: 0 });
    expect(result.find((n) => n.id === 'add')!.position).toEqual({ x: 0, y: 136 });
    expect(result.find((n) => n.id === 'c')!.position).toEqual({ x: 0, y: 204 });
  });

  it('leaves the input array alone', () => {
    const pinned = new Map<string, XYPosition>([['a', { x: 99, y: 99 }]]);
    applyPinned(LAID_OUT, pinned);

    expect(LAID_OUT[0].position).toEqual({ x: 0, y: 0 });
  });
});
