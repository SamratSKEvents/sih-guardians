/**
 * Demo tour → Workspace. Same announce-and-listen shape as `tabs.ts`: the tour
 * says which page of the investigation to show, the Workspace follows.
 *
 * The last view is kept, because the tour asks for a page before the
 * Workspace it opened has mounted; the Workspace applies it on subscribe.
 */

import type { DetectionPanel, ForecastDirection, ForecastPanel, ResponsePanel } from './investigate/Workspace';

export type DemoView =
  | { tab: 'detection'; page: DetectionPanel }
  | { tab: 'temporal'; page: ForecastPanel; direction: ForecastDirection }
  | { tab: 'response'; page: ResponsePanel };

let current: DemoView | undefined;
const listeners = new Set<(view: DemoView) => void>();

export function demoGoto(view: DemoView | undefined) {
  current = view;
  if (view) listeners.forEach((listener) => listener(view));
}

export function onDemoGoto(listener: (view: DemoView) => void) {
  listeners.add(listener);
  if (current) listener(current);
  return () => void listeners.delete(listener);
}

/* The tour picking a slick on the Spills globe: the map flies to it and opens its card. */
const slickListeners = new Set<(slickId: string) => void>();

export function demoSelectSlick(slickId: string) {
  slickListeners.forEach((listener) => listener(slickId));
}

export function onDemoSelectSlick(listener: (slickId: string) => void) {
  slickListeners.add(listener);
  return () => void slickListeners.delete(listener);
}
