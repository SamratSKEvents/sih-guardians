/**
 * Header tabs.
 *
 * They sit immediately after the two route links and belong to the SAME
 * selection as them: Spills, Dashboard and each open tab are all "the thing
 * currently on the stage", and exactly one of them is. That is why a tab is
 * not a toggle — clicking a route link closes nothing, it just makes the route
 * current again, and the tab is still there to come back to.
 *
 * Capped at two. A console whose header can grow an unbounded strip of tabs
 * has a header that moves, and the two route links stop being findable.
 *
 * The panel is deliberately blank: the place exists before the thing that goes
 * in it. Give `render` something real per tab when there is something real.
 */

import type { ReactNode } from 'react';
import { InvestigateSurface } from './Investigate';
import { shortId } from '../format';

export const MAX_TABS = 2;

export interface TabItem {
  id: string;
  label: string;
  render: () => ReactNode;
}

/**
 * A slick under investigation. The id is in the tab's own id, so asking to
 * investigate the same slick twice focuses the tab you already have rather
 * than opening a second copy of it.
 */
export function investigationTab(slickId: string): TabItem {
  return {
    id: `slick:${slickId}`,
    label: shortId(slickId),
    render: () => <InvestigateSurface slickId={slickId} />,
  };
}

/*
 * The map card sits three components below the tab strip and shares no state
 * with it. Rather than thread a callback through Spills and EarthMap, which
 * neither of them has any reason to know about, the card announces and the
 * shell listens.
 */
const listeners = new Set<(slickId: string) => void>();

/** Ask the shell to open an investigation. Called from the map card. */
export const investigate = (slickId: string) => listeners.forEach((listener) => listener(slickId));

export function onInvestigate(listener: (slickId: string) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
