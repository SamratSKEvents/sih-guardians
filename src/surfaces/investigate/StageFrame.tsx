/**
 * Where a stage's two halves go.
 *
 * The chart is the surface: it fills the whole left side, edge to edge, with
 * no frame around it. Everything a stage says ABOUT the chart — its notices,
 * its fields, its tables — reads down the right column beside the stage list,
 * which is where the operator is already looking for state.
 *
 * The stage renders in the rail, where it already sits, and sends only its
 * chart across to the map with a portal. One direction, one portal: splitting
 * every stage into a chart component and a body component would have meant
 * both halves sharing state through the workspace, for a layout change.
 *
 * A stage with nothing to draw sends no chart — including the ones that
 * return a gap panel before they reach here — and the workspace falls back to
 * the slick on its own. Exactly one chart is mounted either way: two Cesium
 * viewers is two WebGL contexts, and the hidden one renders at zero size and
 * throws.
 */

import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SlickFeature } from '../../api/slicks';
import { CesiumChart } from './CesiumChart';
import { extentOf } from './chart-types';
import { ringsOf, slickLayer } from './geometry';

interface Hosts {
  map: HTMLElement | null;
  /** The row under the map, where a stage's timeline bar docks full width. */
  dock: HTMLElement | null;
  slick: SlickFeature;
  /**
   * Told whether this stage put a chart on the map.
   *
   * Several stages return a gap panel before they ever reach `StageFrame` —
   * no bundle, no candidates, nothing to draw — and with no chart portalled
   * the map region would simply be empty. The host needs to know, and it
   * cannot tell by looking: the portal renders into it either way.
   */
  setHasChart: (has: boolean) => void;
}

const HostContext = createContext<Hosts | undefined>(undefined);

export const StageHosts = HostContext.Provider;

export function StageFrame({ chart, children }: { chart?: ReactNode; children: ReactNode }) {
  const hosts = useContext(HostContext);
  const drew = !!chart;
  const tell = hosts?.setHasChart;
  useLayoutEffect(() => {
    if (!drew || !tell) return;
    tell(true);
    return () => tell(false);
  }, [drew, tell]);
  return (
    <>
      {chart && hosts?.map && createPortal(chart, hosts.map)}
      <div className="stage">{children}</div>
    </>
  );
}

/** Send a bar to the row under the map: a layout row, not something floating on the chart. */
export function Dock({ children }: { children: ReactNode }) {
  const hosts = useContext(HostContext);
  return hosts?.dock ? createPortal(children, hosts.dock) : null;
}

/**
 * The fallback chart: the slick and nothing else.
 *
 * A stage with no data still has a map, because the thing under investigation
 * exists whether or not the drift was run. An empty panel where the chart
 * lives would read as a broken screen rather than as a missing dataset.
 */
export function SlickChart({ slick }: { slick: SlickFeature }) {
  const centroid = slick.properties.centroid;
  const point = Array.isArray(centroid) ? { lon: Number(centroid[0]), lat: Number(centroid[1]) } : undefined;
  const outline = ringsOf(slick.geometry)
    .flat()
    .map(([lon, lat]) => ({ lon, lat }));
  const layer = slickLayer(slick.geometry);
  return (
    <CesiumChart
      extent={extentOf(outline.length ? outline : point ? [point] : [], point ?? { lon: 0, lat: 0 })}
      layers={layer ? [layer] : []}
    />
  );
}
