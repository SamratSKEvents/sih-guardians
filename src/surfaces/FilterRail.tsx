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

import { useEffect, useMemo, useState } from 'react';
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
import { loadSlickVessels, type SlickVessel } from '../layers/slickVessels';
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
  match: number;
}

export const INITIAL_FILTERS: FilterState = {
  layers: { slicks: true, backtrack: true, forecast: true, ais: false, wind: false },
  dates: ['', ''],
  area: [0, 100],
  query: '',
  sources: { vessel: true, dark: false, none: true },
  match: 0,
};

/* Candidate vessels per slick (public/data/slick-vessels.json). Slicks with
 * none listed are the "no potential source" rows. */
function useCandidates() {
  const [list, setList] = useState<SlickVessel[]>([]);
  useEffect(() => { loadSlickVessels().then(setList); }, []);
  return useMemo(() => {
    const by = new Map<string, SlickVessel['vessel'][]>();
    for (const { slickId, vessel } of list) by.set(slickId, [...(by.get(slickId) ?? []), vessel]);
    return by;
  }, [list]);
}

type Vessel = SlickVessel['vessel'] & { score?: number; gaps?: unknown[]; imo?: string };

/** The rail's source filters as a per-slick test, or undefined when they let everything through. */
export function useSlickFilter(f: FilterState) {
  const by = useCandidates();
  const q = f.query.trim().toLowerCase();
  const { vessel, none, dark } = f.sources;
  return useMemo(() => {
    if (vessel && none && !dark && !q && f.match <= 0) return undefined;
    const fits = (v: Vessel) =>
      (v.score ?? 0) >= f.match &&
      (!dark || (v.gaps?.length ?? 0) > 0) &&
      (!q || [v.name, v.flag, v.mmsi, v.imo, v.type].some((x) => String(x ?? '').toLowerCase().includes(q)));
    return (id: string) => {
      const vs = by.get(id) as Vessel[] | undefined;
      if (!vs) return none && !dark && !q && f.match <= 0;
      return vessel && vs.some(fits);
    };
  }, [by, vessel, none, dark, q, f.match]);
}

/** How many filters are actually excluding something right now. */
function activeCount(f: FilterState, from: string, to: string) {
  let n = 0;
  // Narrower than the catalog's own extent, on either end, is one filter.
  if ((f.dates[0] && f.dates[0] > from) || (f.dates[1] && f.dates[1] < to)) n += 1;
  if (f.area[0] > 0 || f.area[1] < 100) n += 1;
  if (f.query.trim()) n += 1;
  if (!f.sources.vessel) n += 1;
  if (!f.sources.none) n += 1;
  if (f.sources.dark) n += 1;
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
  const by = useCandidates();
  const darkCount = [...by.values()].filter((vs) => vs.some((v) => ((v as Vessel).gaps?.length ?? 0) > 0)).length;

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
            <Toggle
              label="Vessel identified nearby"
              value={String(by.size)}
              checked={filters.sources.vessel}
              onChange={(checked) => set('sources', { ...filters.sources, vessel: checked })}
            />
            <Toggle
              label="No potential source identified"
              checked={filters.sources.none}
              onChange={(checked) => set('sources', { ...filters.sources, none: checked })}
            />
            {/* Nested under its parent: it narrows that row rather than
              * standing beside it, and it is meaningless when vessels are off. */}
            <div className="fr-nested">
              <Switch
                label="Dark vessels only"
                info="Vessels whose AIS went quiet around the detection. Absence of a signal is not proof of anything."
                value={String(darkCount)}
                checked={filters.sources.dark ?? false}
                disabled={!filters.sources.vessel}
                onChange={(checked) => set('sources', { ...filters.sources, dark: checked })}
              />
            </div>
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
