/**
 * Spills: browse the catalog.
 *
 * The PlainGIS composition. A persistent filter rail down the left, the chart
 * beside it, and the one clock docked along the bottom.
 *
 * The filters live in a real column rather than floating over the chart,
 * because they are furniture: open most of the day, and a shadow between the
 * operator and the map all day is a cost with no benefit. Selection detail
 * still floats, because it genuinely comes and goes — that is `SlickCard`,
 * which the map owns.
 *
 * The chart here is the real globe. In the gallery this was a still image with
 * mock labels dropped on it; the arrangement is the same one, which is the
 * point of having designed it before wiring it.
 *
 * The date window and the area range reach the map. The source and area-of-
 * interest facets are still layout only: the catalog has no field for them yet.
 */

import { useEffect, useState } from 'react';
import { fetchSlickTimeRange } from '../api/slicks';
import { EarthMap } from '../components/map/EarthMap';
import { InfoDot, Segmented, Timeline, useTimeline } from '../design/components';
import { AIS_DEMO_WINDOW } from '../layers/aisDemo';
import type { SlickTimeMode } from '../layers';
import { FilterRail, INITIAL_FILTERS, type FilterState } from './FilterRail';
import './spills.css';

const DAY_MS = 86_400_000;

/**
 * What the clock does to the map.
 *
 * It sits with the speed control rather than in the Layers legend: it changes
 * what the CLOCK does, not which layers are drawn.
 *
 * The labels name the two SETS of detections, not the two behaviours. "All"
 * and "Only" were the first attempt and neither says what it is all OF, or
 * only OF — you had to hover to find out, which for a control that changes
 * what the map contains is too late. "All dates" and "This day" answer it in
 * the label, and sitting beside a clock reading "2 Sept 2026" leaves nothing
 * for "this day" to be.
 */
const TIME_MODES: readonly { value: SlickTimeMode; label: string; title: string }[] = [
  {
    value: 'all',
    label: 'All dates',
    title: 'Every detection in the catalog, whatever the clock says',
  },
  {
    value: 'only',
    label: 'This day',
    title: 'Only detections observed on the date shown in the clock',
  },
];

const TIME_MODE_INFO =
  'Which detections the map draws. ' +
  '“All dates” draws the whole catalog, and moving the clock changes nothing. ' +
  '“This day” draws only what was observed on the date in the clock, so moving ' +
  'the clock steps through the record a day at a time.';

// ISO-ordered and unambiguous, which is what a filter field wants; the
// timeline still says "1 Jan 2025" where a person is reading prose.
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' });

/**
 * The observed slicks' time extent, widened to whole UTC days. Undefined until
 * the static catalog provides.
 */
function useSlickWindow() {
  const [range, setRange] = useState<{ start: number; end: number }>();
  useEffect(() => {
    fetchSlickTimeRange()
      .then(({ oldest, newest }) => {
        if (!oldest || !newest) return;
        setRange({
          start: Math.floor(Date.parse(oldest) / DAY_MS) * DAY_MS,
          end: Math.ceil(Date.parse(newest) / DAY_MS) * DAY_MS,
        });
      })
      .catch(() => undefined);
  }, []);
  return range;
}

export function SpillsSurface() {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  // Opens on 'all': the catalog as a whole is the honest first view, and it is
  // what the map showed before this control existed.
  const [timeMode, setTimeMode] = useState<SlickTimeMode>('all');

  // Opens on the newest data: the home view answers "what is happening now".
  const { start, end } = useSlickWindow() ?? AIS_DEMO_WINDOW;
  // The surface owns the one clock. The timeline drives it and the map mirrors
  // it, so nothing keeps a private timer and nothing can drift apart. The
  // window is fixed by the catalog: the timeline shows it, it does not set it.
  const timeline = useTimeline(start, end, { initial: 'end' });

  // The rail's window, in epoch ms and half-open, so the last day is included
  // whole. Undefined while the rail is showing the catalog's full extent —
  // the layer then skips the date test entirely.
  const [fromDay, toDay] = filters.dates;
  const dateRange: [number, number] | undefined =
    fromDay || toDay
      ? [
          fromDay ? Date.parse(`${fromDay}T00:00:00Z`) : start,
          (toDay ? Date.parse(`${toDay}T00:00:00Z`) : end) + DAY_MS,
        ]
      : undefined;

  return (
    <div className="sp">
      <FilterRail
        filters={filters}
        onChange={setFilters}
        from={day.format(start)}
        to={day.format(end)}
      />

      {/* The chart and the dock are rows, not a map with something floating
        * over it. That is what lets the map's own status bar sit on the
        * chart's bottom edge instead of being held clear of the timeline by a
        * hardcoded offset. */}
      <div className="sp-stage">
        <EarthMap
          time={timeline.time}
          timeMode={timeMode}
          dateRange={dateRange}
          // The slider's top stop reads "100+": it lifts the upper bound rather than setting one.
          areaRange={
            filters.area[0] > 0 || filters.area[1] < 100
              ? [filters.area[0], filters.area[1] >= 100 ? undefined : filters.area[1]]
              : undefined
          }
          // Selecting a vessel freezes time so the card describes a fixed moment.
          onFocusChange={(entityId) => entityId && timeline.pause()}
        />

        <Timeline
          timeline={timeline}
          controls={
            <>
              {/* Named and explained in place. A control that changes what is
                * on the map should not need to be operated to be understood. */}
              <span className="sp-mode-label">
                Showing
                <InfoDot text={TIME_MODE_INFO} />
              </span>
              <Segmented
                label="Which detections the map draws"
                value={timeMode}
                onChange={setTimeMode}
                options={TIME_MODES}
              />
            </>
          }
        />
      </div>
    </div>
  );
}
