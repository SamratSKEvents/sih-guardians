/**
 * The filter rail: everything that narrows what the map shows.
 *
 * Layers are deliberately NOT here. A legend answers "what am I looking at",
 * which is a question about the mark under the cursor, so it lives on the
 * chart. A filter answers "what should be on the chart at all", which is a
 * question about the query. They were one list until the difference started
 * mattering.
 *
 * Collapses to a 48px strip of icons and expands back. Collapsed it still
 * reports how many filters are actually doing something, because a hidden
 * filter silently removing half the catalog is the worst failure this panel
 * can have.
 *
 * Section order follows the operator's question, not the data model: what am
 * I looking at, where did it come from, what do I care about protecting, and
 * only then the knobs.
 */

import { useState } from 'react';
import { PanelLeftClose, SlidersHorizontal } from 'lucide-react';
import {
  Advanced,
  DateRangeRow,
  RangeSlider,
  ScaleSlider,
  Search,
  Switch,
  Toggle,
} from '../design/components';
import './filterRail.css';

export interface FilterState {
  layers: Record<string, boolean>;
  /**
   * The date window, as two `yyyy-mm-dd` UTC days, inclusive of both. Empty
   * strings mean "whatever the catalog has": the rail opens showing the full
   * extent rather than a blank field.
   */
  dates: [string, string];
  area: [number, number];
  query: string;
  sources: Record<string, boolean>;
  aoi: Record<string, boolean>;
  match: number;
}

export const INITIAL_FILTERS: FilterState = {
  layers: { slicks: true, backtrack: true, forecast: true, ais: false, wind: false },
  dates: ['', ''],
  area: [0, 100],
  query: '',
  sources: { vessel: true, dark: false, infrastructure: true, none: true },
  aoi: { mpa: false, eez: false, custom: false },
  match: 0.66,
};

/* Facet counts: how many detections each row is currently letting through.
 * Without them, narrowing a filter is guesswork until the map redraws. */
const SOURCE_ROWS = [
  { id: 'vessel', label: 'Vessel identified nearby', count: '412' },
  { id: 'infrastructure', label: 'Oil and gas infrastructure nearby', count: '86' },
  { id: 'none', label: 'No potential source identified', count: '786' },
];

/** How many filters are actually excluding something right now. */
function activeCount(f: FilterState, from: string, to: string) {
  let n = 0;
  // Narrower than the catalog's own extent, on either end, is one filter.
  if ((f.dates[0] && f.dates[0] > from) || (f.dates[1] && f.dates[1] < to)) n += 1;
  if (f.area[0] > 0 || f.area[1] < 100) n += 1;
  if (f.query.trim()) n += 1;
  n += SOURCE_ROWS.filter((row) => !f.sources[row.id]).length;
  if (f.sources.dark) n += 1;
  n += Object.values(f.aoi).filter(Boolean).length;
  if (f.match > 0) n += 1;
  return n;
}

export function FilterRail({
  filters,
  onChange,
  from,
  to,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  /** The catalog's own extent. The bounds of the date filter, not its value. */
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(true);
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value });
  const active = activeCount(filters, from, to);

  if (!open) {
    return (
      <aside className="fr fr-closed" aria-label="Filters">
        <button type="button" className="fr-open" aria-label="Show filters" onClick={() => setOpen(true)}>
          <SlidersHorizontal size={17} />
          {active > 0 && <span className="fr-count num">{active}</span>}
        </button>
      </aside>
    );
  }

  return (
    <aside className="fr" aria-label="Filters">
      <header className="fr-head">
        <h2>Filters</h2>
        {active > 0 && <span className="fr-count num">{active}</span>}
        <button type="button" className="fr-close" aria-label="Hide filters" onClick={() => setOpen(false)}>
          <PanelLeftClose size={16} />
        </button>
      </header>

      <div className="fr-body">
        <Advanced variant="plain" label="Slick filters" collapsible={false}>
          <DateRangeRow
            from={filters.dates[0] || from}
            to={filters.dates[1] || to}
            min={from}
            max={to}
            onChange={(dates) => set('dates', dates)}
          />
          <RangeSlider
            label="Area"
            info="Slick footprint in square kilometres. The top stop is open-ended, so nothing large is hidden by the filter."
            min={0}
            max={100}
            step={5}
            value={filters.area}
            onChange={(value) => set('area', value)}
            ticks={[0, 20, 40, 60, 80, 100]}
            openTop
            unit="km²"
          />
        </Advanced>

        <Advanced variant="plain" label="Source filters" defaultOpen={false} info="What was found near the slick at the time it was detected.">
          <Search
            label="Search sources"
            placeholder="Source by ID, name, flag or tag"
            value={filters.query}
            onChange={(value) => set('query', value)}
            onSubmit={(value) => set('query', value)}
          />
          <div className="fr-checks">
            {SOURCE_ROWS.map((row) => (
              <Toggle
                key={row.id}
                label={row.label}
                value={row.count}
                checked={filters.sources[row.id] ?? false}
                onChange={(checked) => set('sources', { ...filters.sources, [row.id]: checked })}
              />
            ))}
            {/* Nested under its parent: it narrows that row rather than
              * standing beside it, and it is meaningless when vessels are off. */}
            <div className="fr-nested">
              <Switch
                label="Dark vessels only"
                info="Vessels whose AIS went quiet around the detection. Absence of a signal is not proof of anything."
                value="57"
                checked={filters.sources.dark ?? false}
                disabled={!filters.sources.vessel}
                onChange={(checked) => set('sources', { ...filters.sources, dark: checked })}
              />
            </div>
          </div>
        </Advanced>

        <Advanced variant="plain" label="Areas of interest" defaultOpen={false}>
          <div className="fr-checks">
            <Switch
              label="Marine protected areas"
              info="MPAs from the World Database on Protected Areas."
              value="14"
              checked={filters.aoi.mpa}
              onChange={(checked) => set('aoi', { ...filters.aoi, mpa: checked })}
            />
            <Switch
              label="Exclusive economic zones"
              info="EEZ boundaries. Shown for context; they carry no enforcement meaning here."
              value="6"
              checked={filters.aoi.eez}
              onChange={(checked) => set('aoi', { ...filters.aoi, eez: checked })}
            />
            {/* No figure: this one is an action, not a set of things in view. */}
            <Switch
              label="Draw or upload an area"
              info="Restrict every layer to a boundary you supply."
              checked={filters.aoi.custom}
              onChange={(checked) => set('aoi', { ...filters.aoi, custom: checked })}
            />
          </div>
        </Advanced>

        <Advanced variant="plain" label="Advanced filters" defaultOpen={false}>
          <ScaleSlider
            label="Slick-source match"
            info="How closely a candidate track must fit the reconstructed drift before it is listed. Raising it hides weak candidates; it does not make the remaining ones true."
            value={filters.match}
            onChange={(value) => set('match', value)}
            low="Weak"
            high="Strong"
          />
        </Advanced>
      </div>
    </aside>
  );
}
