/**
 * The master timeline, docked under the map.
 *
 * This began as the app's own `src/components/timeline/{Timeline.tsx,
 * useTimeline.ts}` and has now replaced them: App.tsx imports this file and
 * the private copy is gone, so there is one timeline rather than two drifting
 * apart. Structure, behaviour, tick logic and class names are still the app's.
 * Three changes, all deliberate:
 *
 *   1. Icons come from lucide rather than the app's hand-rolled SVG paths,
 *      which is the icon rule for this library.
 *   2. Token names are remapped to the sampled palette (--surface becomes
 *      --panel, --action-fill becomes --action, and so on). No value is
 *      invented; only the names moved.
 *   3. Transport and speed use this library's IconButton and Segmented rather
 *      than the app's private lookalikes of them. The app styled a segmented
 *      control by hand, in mono, at 3px corners; here that is the same
 *      component every other surface uses, so it cannot drift out of step.
 *
 * The hook lives here too rather than in its own file: one import, and the
 * component is useless without it.
 *
 * Transport (step, play, speed), the current UTC time, and one scrubbable
 * track across the time window. It owns no state: it renders and drives a
 * TimelineState, which the rest of the page reads too.
 *
 * The window is a LABEL, not a control. Its bounds come from the catalog and
 * the operator does not choose them here.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { ChevronDown, ChevronUp, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton, Segmented } from './controls';

/* ============================================================== the clock ==
 *
 * One requestAnimationFrame loop advances time; everything temporal (the map,
 * the timeline cursor, later the panels) reads the same value, so nothing
 * keeps its own timer and nothing can drift apart.
 *
 * The rate scales with the window. A short, incident-sized window keeps the
 * GUARDIANS demo's 1x = 15 simulated minutes per second (one drift step per
 * second); a long, historical window plays end to end in about two minutes at
 * 1x, so twenty months of slicks are browsable rather than a week-long wait.
 */

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 5, 10] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const FULL_WINDOW_AT_1X_S = 120;

/** Nice step sizes; the smallest that keeps a window under ~1000 steps wins. */
const STEPS_MS = [15 * MINUTE_MS, HOUR_MS, 6 * HOUR_MS, DAY_MS, 7 * DAY_MS];

// Every update re-renders the page and redraws the globe; 30 Hz keeps motion
// smooth without doing that work at 60-144 Hz.
const UPDATE_INTERVAL_MS = 1000 / 30 - 2; // slack so a 60 Hz display updates every other frame

export interface TimelineState {
  start: number;
  end: number;
  time: number;
  playing: boolean;
  speed: PlaybackSpeed;
  /** Simulated ms per real second at 1x. */
  rate: number;
  /** One press of the step buttons. */
  stepMs: number;
  setTime: (time: number) => void;
  step: (deltaMs: number) => void;
  togglePlay: () => void;
  pause: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
}

export function useTimeline(
  start: number,
  end: number,
  { initial = 'start', autoplay = false }: { initial?: 'start' | 'end'; autoplay?: boolean } = {},
): TimelineState {
  const initialTime = initial === 'end' ? end : start;
  const [time, setTimeState] = useState(initialTime);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  // The loop reads the latest time without re-subscribing every frame.
  const timeRef = useRef(initialTime);

  const span = end - start;
  const rate = Math.max(15 * MINUTE_MS, span / FULL_WINDOW_AT_1X_S);
  const stepMs = STEPS_MS.find((step) => span / step <= 1000) ?? STEPS_MS.at(-1)!;

  const setTime = useCallback(
    (next: number) => {
      timeRef.current = Math.min(end, Math.max(start, next));
      setTimeState(timeRef.current);
    },
    [start, end],
  );

  // A new window (e.g. the slick range arriving) restarts the clock in it.
  useEffect(() => {
    setTime(initial === 'end' ? end : start);
    setPlaying(autoplay);
  }, [start, end, initial, autoplay, setTime]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      if (now - last < UPDATE_INTERVAL_MS) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // A tab returning from the background must not jump the investigation.
      const elapsed = Math.min((now - last) / 1000, 0.25);
      last = now;
      setTime(timeRef.current + elapsed * speed * rate);
      if (timeRef.current >= end) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, rate, end, setTime]);

  const togglePlay = useCallback(() => {
    // Play at the end of the window restarts it rather than doing nothing.
    if (!playing && timeRef.current >= end) setTime(start);
    setPlaying(!playing);
  }, [playing, start, end, setTime]);

  return {
    start,
    end,
    time,
    playing,
    speed,
    rate,
    stepMs,
    setTime,
    step: useCallback((deltaMs: number) => setTime(timeRef.current + deltaMs), [setTime]),
    togglePlay,
    pause: useCallback(() => setPlaying(false), []),
    setSpeed,
  };
}

/* ============================================================== the widget */

/** Windows longer than this read in dates, not clock times. */
const LONG_WINDOW_MS = 4 * DAY_MS;

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (ms: number) => {
  const date = new Date(ms);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};
const longDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const shortDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' });
const stamp = (ms: number) => `${shortDate.format(ms)} ${clock(ms)}`;

function duration(ms: number) {
  if (ms < HOUR_MS) return `${Math.round(ms / 60_000)} min`;
  if (ms < DAY_MS) return `${+(ms / HOUR_MS).toFixed(1)} h`;
  const days = +(ms / DAY_MS).toFixed(1);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Built once: Segmented takes string values, speeds are numbers. */
const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({
  value: String(speed),
  // .5x, not the vulgar fraction: it sits in the same column as 2x and 10x,
  // and a screen reader says "point five" rather than "one half".
  label: `${speed}\u00d7`,
}));

interface Tick {
  ms: number;
  percent: number;
  label?: string;
}

/**
 * Ticks at a calendar unit that suits the window (hours, days or months),
 * labelled often enough for roughly a dozen labels. Labels hang right of their
 * tick, so none is placed where it would be clipped at the end.
 */
function useTicks(start: number, end: number): Tick[] {
  return useMemo(() => {
    const span = end - start;
    const ticks: Tick[] = [];
    const push = (ms: number, label: string | undefined, labelSpanMs: number) =>
      ticks.push({
        ms,
        percent: ((ms - start) / span) * 100,
        label: label && ms < end - labelSpanMs * 0.5 ? label : undefined,
      });

    if (span <= LONG_WINDOW_MS) {
      const every = [1, 2, 3, 6, 12, 24].find((step) => span / (step * HOUR_MS) <= 12) ?? 24;
      for (let ms = Math.ceil(start / HOUR_MS) * HOUR_MS; ms <= end; ms += HOUR_MS) {
        const hour = new Date(ms).getUTCHours();
        // Midnight carries the date, so a multi-day window reads without the readout.
        push(ms, hour % every === 0 ? (hour === 0 ? shortDate.format(ms) : clock(ms)) : undefined, every * HOUR_MS);
      }
    } else if (span <= 120 * DAY_MS) {
      const every = [1, 2, 7, 14].find((step) => span / (step * DAY_MS) <= 12) ?? 14;
      for (let ms = Math.ceil(start / DAY_MS) * DAY_MS, day = 0; ms <= end; ms += DAY_MS, day += 1) {
        push(ms, day % every === 0 ? shortDate.format(ms) : undefined, every * DAY_MS);
      }
    } else {
      const every = [1, 2, 3, 6, 12].find((step) => span / (step * 30.44 * DAY_MS) <= 12) ?? 12;
      const first = new Date(start);
      for (let index = first.getUTCMonth() + (first.getUTCDate() > 1 || start % DAY_MS ? 1 : 0); ; index += 1) {
        const ms = Date.UTC(first.getUTCFullYear(), index, 1);
        if (ms > end) break;
        const month = new Date(ms).getUTCMonth();
        // January carries the year; other labelled months their name.
        const label = month % every === 0 ? (month === 0 ? String(new Date(ms).getUTCFullYear()) : monthName.format(ms)) : undefined;
        push(ms, label, every * 30.44 * DAY_MS);
      }
    }
    return ticks;
  }, [start, end]);
}

export function Timeline({
  timeline,
  summary,
  controls,
}: {
  timeline: TimelineState;
  summary?: ReactNode;
  /**
   * Surface-supplied controls for the bar, placed with the speed control
   * because they modify what the clock DOES rather than what is on the map.
   *
   * A slot rather than a prop with known values: what the clock means differs
   * per surface, and the library has no business knowing what a detection is.
   */
  controls?: ReactNode;
}) {
  const { start, end, time, playing, speed, rate, stepMs, setTime, step, togglePlay, setSpeed } = timeline;
  const long = end - start > LONG_WINDOW_MS;
  // Long windows read in dates: the clock would spin too fast to be read.
  const at = (ms: number) => (long ? fullDate.format(ms) : stamp(ms));
  const [collapsed, setCollapsed] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const ticks = useTicks(start, end);
  const percent = ((time - start) / Math.max(1, end - start)) * 100;
  const bounds = { from: at(start), to: at(end) };

  const playButton = (
    <button type="button" className="tl-play" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
      {playing ? <Pause size={15} /> : <Play size={15} />}
      <span className="visually-hidden">{playing ? 'Pause' : 'Play'}</span>
    </button>
  );

  if (collapsed) {
    return (
      <footer className="tl tl-collapsed">
        {playButton}

        <span className="tl-collapsed-time num">
          {at(time)}
          <span className="tl-zone">UTC</span>
        </span>

        {/* The position line runs along the bottom edge instead of taking a
          * column, so the row itself is free for whatever the surface most
          * wants kept visible while the timeline is folded away. */}
        {summary && <span className="tl-summary">{summary}</span>}

        <span className="tl-collapsed-window num">
          {at(start)} <i aria-hidden="true">–</i> {at(end)}
        </span>

        <span className="tl-toggle">
          <IconButton label="Show timeline" onClick={() => setCollapsed(false)}>
            <ChevronUp size={16} />
          </IconButton>
        </span>

        {/* Folding the timeline away must not also hide where you are in the
          * record. */}
        <span
          className="tl-mini"
          role="progressbar"
          aria-label="Position in the record"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={time}
          aria-valuetext={`${longDate.format(time)} ${clock(time)} UTC`}
        >
          <span className="tl-mini-fill" style={{ width: `${percent}%` }} />
        </span>
      </footer>
    );
  }

  const scrub = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTime(start + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (end - start));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub(event.clientX);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => step((event.shiftKey ? -10 : -1) * stepMs),
      ArrowRight: () => step((event.shiftKey ? 10 : 1) * stepMs),
      Home: () => setTime(start),
      End: () => setTime(end),
      ' ': togglePlay,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  return (
    <footer className="tl">
      <div className="tl-bar">
        <div className="tl-transport">
          <IconButton label={`Back ${duration(stepMs)}`} onClick={() => step(-stepMs)}>
            <SkipBack size={14} />
          </IconButton>
          {playButton}
          <IconButton label={`Forward ${duration(stepMs)}`} onClick={() => step(stepMs)}>
            <SkipForward size={14} />
          </IconButton>
        </div>

        <div className="tl-readout" aria-live="off">
          {long ? (
            <>
              <span className="tl-clock num">{fullDate.format(time)}</span>
              <span className="tl-date">
                {weekday.format(time)} · <span className="num">{clock(time)}</span> UTC
              </span>
            </>
          ) : (
            <>
              <span className="tl-clock num">{clock(time)}</span>
              <span className="tl-zone">UTC</span>
              <span className="tl-date">{longDate.format(time)}</span>
            </>
          )}
        </div>

        {controls && <div className="tl-controls">{controls}</div>}

        <div className="tl-speeds" title={`${duration(speed * rate)} per second`}>
          <Segmented
            label="Playback speed"
            value={String(speed)}
            onChange={(value) => setSpeed(Number(value) as PlaybackSpeed)}
            options={SPEED_OPTIONS}
          />
        </div>

        <span className="tl-toggle">
          <IconButton label="Hide timeline" onClick={() => setCollapsed(true)}>
            <ChevronDown size={16} />
          </IconButton>
        </span>
      </div>

      <div className="tl-rail">
        {/* The bounds sit at the ends of the rail they describe, not in the
          * bar. They are labels: the catalog sets them, not the operator. */}
        <span className="tl-bound num">{bounds.from}</span>
        <div
          ref={trackRef}
          className="tl-track"
          role="slider"
          tabIndex={0}
          aria-label="Time"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={time}
          aria-valuetext={`${longDate.format(time)} ${clock(time)} UTC`}
          onPointerDown={onPointerDown}
          onPointerMove={(event) => event.buttons === 1 && scrub(event.clientX)}
          onKeyDown={onKeyDown}
        >
          <span className="tl-elapsed" style={{ width: `${percent}%` }} aria-hidden="true" />
          {ticks.map((tick) => (
            <span
              key={tick.ms}
              className={`tl-tick ${tick.label ? 'is-labelled' : ''}`}
              style={{ left: `${tick.percent}%` }}
              aria-hidden="true"
            >
              {tick.label && <span className="tl-tick-label num">{tick.label}</span>}
            </span>
          ))}
          <span className="tl-cursor" style={{ left: `${percent}%` }} aria-hidden="true" />
        </div>
        <span className="tl-bound num">{bounds.to}</span>
      </div>
    </footer>
  );
}
