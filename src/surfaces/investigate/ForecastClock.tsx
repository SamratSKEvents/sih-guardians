/**
 * The run's clock: the timeline bar, docked full width under the map on
 * Forecast & impact.
 */

import { useMemo } from 'react';
import { Meter, Timeline } from '../../design/components';
import type { GeoPolygon } from '../../api/slicks';
import type { LonLat } from '../../incidents/types';
import { extentOf, type Extent } from './chart-types';
import { ringsOf } from './geometry';
import { useForecast } from '../../forecast/context';

export function ForecastClock() {
  const { timeline, run, forcing, hoursIn } = useForecast();
  // The library bar as-is, the one Spills docks: it brings its own ground,
  // edge and collapse. No chip around it; it is a row, not a floating panel.
  return (
    <Timeline
      timeline={timeline}
      summary={
        run.failed ? (
          <span className="imap-clock-note">Model stopped</span>
        ) : run.catching && (!run.frame || Math.abs(hoursIn - run.frame.hour) >= 0.25) ? (
          <span className="imap-clock-note">
            Computing at {run.dx ?? 50} m… +{(run.frame?.hour ?? 0).toFixed(1)} h
          </span>
        ) : (
          <span className="imap-clock-note">
            +{hoursIn.toFixed(1)} h · {forcing.measured ? 'measured forcing' : 'synthetic forcing'}
          </span>
        )
      }
    />
  );
}

/** Shown while the model is stepping to where the clock is. */
export function RunProgress() {
  const { run, hoursIn } = useForecast();
  const at = run.frame?.hour ?? 0;
  // Playing, the model trails the clock by a few simulated minutes; that is
  // keeping up, not computing. Only a scrub leaves it this far behind.
  if (!run.catching || (run.frame && Math.abs(hoursIn - at) < 0.25)) return null;
  return (
    <section>
      <h3>Computing</h3>
      <Meter label={`Stepping to +${hoursIn.toFixed(1)} h at ${run.dx ?? 50} m`} value={hoursIn > 0 ? Math.min(1, at / hoursIn) : 0} />
      <p className="stage-note">
        Nothing is stored: every field is computed from the detection when the clock asks for it, and a moment you
        scrub back to is run again from +0 h.
      </p>
    </section>
  );
}

/**
 * Where the drift charts look.
 *
 * The detection until the horizon run has reached +24 h — a few seconds —
 * then everywhere the oil goes in it, so the operator sees the drift rather
 * than a speck. That is one reframe, early; nothing moves the camera after.
 */
export function useDriftExtent(geometry: GeoPolygon | null, track: readonly LonLat[], centre: LonLat | undefined): Extent {
  const { reach } = useForecast();
  const points: LonLat[] = [...track];
  if (reach) points.push({ lon: reach[0], lat: reach[1] }, { lon: reach[2], lat: reach[3] });
  for (const ring of ringsOf(geometry)) for (const [lon, lat] of ring) points.push({ lon, lat });
  // 0.02° — about 2 km — so a slick a few hundred metres long is not framed
  // edge to edge.
  const box = extentOf(points, centre ?? { lon: 0, lat: 0 }, 0.02);
  // Keyed on the numbers: callers rebuild `track` every render, and a new
  // array here would re-home the camera on every clock tick.
  const key = box.join(',');
  return useMemo(() => key.split(',').map(Number) as Extent, [key]);
}
