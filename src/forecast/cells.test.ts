import { describe, expect, it } from 'vitest';
import { cellRings } from './cells';

describe('cellRings', () => {
  it('traces one square for one cell', () => {
    const r = cellRings(new Set(['0,0']), 1);
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(4);
  });
  it('keeps two separated lobes apart instead of bridging them', () => {
    const r = cellRings(new Set(['0,0', '1,0', '5,0', '6,0']), 1);
    expect(r).toHaveLength(2);
  });
  it('an L-shape is one ring with 6 corners, not its hull', () => {
    const r = cellRings(new Set(['0,0', '1,0', '0,1']), 1);
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(6);
  });
  it('a ring with a hole keeps only the outer boundary', () => {
    const s = new Set<string>();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!(i === 1 && j === 1)) s.add(`${i},${j}`);
    expect(cellRings(s, 1)).toHaveLength(1);
  });
});
