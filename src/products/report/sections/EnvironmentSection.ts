import { C, DASH, LW, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { drawLineChart } from '../charts/LineChart';
import { drawDirectionTimeRose, drawDriftComposition, driftVector } from '../charts/DirectionChart';
import { bearingOf } from '../utils/geo';
import { u, utcShort } from '../utils/units';

export function environmentSection(ctx: ReportContext) {
  const env = ctx.data.environment;
  const recs = env.records;
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '05', sectionTitle: 'Environmental conditions' });
  f.sectionHeader(
    `Wind and surface-current forcing at the slick centroid over the ${Math.abs(recs[0].offsetH)} h hindcast window. ${env.conventions} Drift is derived as current + ${env.windageFactorPct.toFixed(1)} % windage and is a modelled quantity.`,
  );

  f.heading('Forcing summary at 6-hour intervals', 140);
  const rows = env.summaryOffsetsH.map((h) => recs.find((r) => r.offsetH === h)!);
  drawEngineeringTable(f, {
    caption: 'Wind, current and derived drift at the slick centroid (illustrative)',
    rows,
    columns: [
      { header: 'Hour', w: 0.6, font: 'monoMedium', value: (r) => u.rel(r.offsetH) },
      { header: 'Time', unit: 'UTC', w: 0.95, font: 'mono', value: (r) => utcShort(r.time) },
      { header: 'Wind speed', unit: 'm/s', w: 0.75, font: 'mono', align: 'right', value: (r) => r.windMs.toFixed(1) },
      { header: 'Wind dir. (from)', unit: '° true', w: 0.8, font: 'mono', align: 'right', value: (r) => u.bearing(r.windFromDeg) },
      { header: 'Current speed', unit: 'm/s', w: 0.8, font: 'mono', align: 'right', value: (r) => r.currentMs.toFixed(2) },
      { header: 'Current dir. (to)', unit: '° true', w: 0.8, font: 'mono', align: 'right', value: (r) => u.bearing(r.currentToDeg) },
      { header: 'Drift speed (model)', unit: 'm/s', w: 0.85, font: 'mono', align: 'right', value: (r) => Math.hypot(driftVector(r, env.windageFactorPct).x, driftVector(r, env.windageFactorPct).y).toFixed(2) },
      { header: 'Drift dir. (to)', unit: '° true', w: 0.75, font: 'mono', align: 'right', value: (r) => u.bearing(bearingOf(driftVector(r, env.windageFactorPct))) },
      { header: 'Hs', unit: 'm', w: 0.5, font: 'mono', align: 'right', value: (r) => r.waveHsM.toFixed(2) },
    ],
    highlight: (r) => r.offsetH === 0,
  });

  const xAxis = { min: -24, max: 0, ticks: [-24, -21, -18, -15, -12, -9, -6, -3, 0], format: (v: number) => (v === 0 ? 'T0' : `${v}`), title: 'Hours relative to observation (h)' };
  const marks = (sel: (r: (typeof recs)[number]) => number) => recs.map((r) => [r.offsetH, sel(r)] as [number, number]);

  f.figure(186, 'Wind speed at the slick centroid — previous 24 hours', (b) =>
    drawLineChart(ctx, b, {
      x: xAxis,
      y: { min: 0, max: 12, ticks: [0, 2, 4, 6, 8, 10, 12], format: (v) => v.toFixed(0), title: 'Wind speed (m/s)' },
      vbands: [{ from: -18, to: -12, label: 'STRONGEST RELEASE INTERVAL', hatch: true }],
      hlines: [
        { y: 3, label: 'Lower SAR slick-detection limit ≈ 3 m/s' },
        { y: 10, label: 'Upper SAR slick-detection limit ≈ 10 m/s' },
      ],
      series: [{ label: 'Wind speed, 10 m (hourly)', points: marks((r) => r.windMs), style: { lw: 1.1 }, marker: 'square' }],
      legendCols: 2,
    }),
    { note: 'ILLUSTRATIVE' },
  );

  f.figure(186, 'Surface current and modelled drift speed — previous 24 hours', (b) =>
    drawLineChart(ctx, b, {
      x: xAxis,
      y: { min: 0, max: 0.7, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], format: (v) => v.toFixed(1), title: 'Speed (m/s)' },
      vbands: [{ from: -18, to: -12, label: 'STRONGEST RELEASE INTERVAL', hatch: true }],
      series: [
        { label: 'Surface current (hourly)', points: marks((r) => r.currentMs), style: { lw: 1.1 }, marker: 'circle', markerFill: false },
        { label: `Modelled drift = current + ${env.windageFactorPct.toFixed(1)} % wind`, points: marks((r) => Math.hypot(driftVector(r, env.windageFactorPct).x, driftVector(r, env.windageFactorPct).y)), style: { lw: 1.1, color: C.model, dash: DASH.dashed }, marker: 'diamond' },
      ],
      legendCols: 2,
    }),
    { note: 'ILLUSTRATIVE' },
  );

  f.heading('Directional forcing', 290);
  f.figure(272, 'Wind, current and modelled drift direction over time, and vector composition at T0', (b) => {
    const lw = b.w * 0.52;
    drawDirectionTimeRose(ctx, { x: b.x, y: b.y, w: lw, h: b.h }, recs, env.windageFactorPct, env.summaryOffsetsH);
    ctx.line(b.x + lw + 8, b.y, b.x + lw + 8, b.y + b.h, LW.hair, C.grid);
    drawDriftComposition(ctx, { x: b.x + lw + 22, y: b.y, w: b.w - lw - 22, h: b.h }, recs[recs.length - 1], env.windageFactorPct);
  }, { note: 'DIRECTIONS SHOWN AS TOWARDS' });

  // progressive vector diagram (cumulative displacement, T−24 h → T0)
  const cum = (sel: (r: (typeof recs)[number]) => { x: number; y: number }) => {
    let x = 0, y = 0;
    const pts: [number, number][] = [[0, 0]];
    recs.slice(1).forEach((r) => {
      const v = sel(r);
      x += v.x * 3.6;
      y += v.y * 3.6;
      pts.push([x, y]);
    });
    return pts;
  };
  const vec = (b: number, m: number) => ({ x: Math.sin((b * Math.PI) / 180) * m, y: Math.cos((b * Math.PI) / 180) * m });
  const pvdDrift = cum((r) => driftVector(r, env.windageFactorPct));
  const pvdCur = cum((r) => vec(r.currentToDeg, r.currentMs));
  const pvdWind = cum((r) => vec(r.windFromDeg + 180, (r.windMs * env.windageFactorPct) / 100));
  const every6 = (pts: [number, number][]) => pts.filter((_, i) => i % 6 === 0);
  f.heading('Progressive vector diagram', 220);
  const pvW = f.w * 0.56;
  const py0 = f.y;
  f.figure(206, 'Cumulative displacement from T−24 h (east / north, km)', (b) =>
    drawLineChart(ctx, b, {
      x: { min: 0, max: 45, ticks: [0, 10, 20, 30, 40], format: (v) => v.toFixed(0), title: 'East displacement (km)' },
      y: { min: 0, max: 32, ticks: [0, 8, 16, 24, 32], format: (v) => v.toFixed(0), title: 'North displacement (km)' },
      series: [
        { label: 'Current only', points: pvdCur, style: { lw: 1 }, marker: undefined },
        { label: 'Windage only', points: pvdWind, style: { lw: 1, dash: DASH.dotted } },
        { label: 'Modelled drift', points: pvdDrift, style: { lw: 1.2, color: C.model, dash: DASH.dashed } },
        { label: '6-h marks', points: every6(pvdDrift), style: { lw: 0.01, color: C.model }, marker: 'diamond' },
      ],
      legendCols: 2,
    }), { w: pvW });
  const pyA = f.y;
  f.y = py0;
  const tx = f.x + pvW + 16, tw = f.w - pvW - 16;
  ctx.font('condSemi', T.micro, C.ink3);
  ctx.textMid('CUMULATIVE MODELLED DRIFT', tx, f.y + 4, { cs: 0.4 });
  f.y += 10;
  drawEngineeringTable(f, {
    x: tx,
    w: tw,
    rows: every6(pvdDrift).map((p, i) => ({ h: -24 + i * 6, p })),
    columns: [
      { header: 'Hour', w: 0.8, font: 'monoMedium', value: (r) => u.rel(r.h) },
      { header: 'East', unit: 'km', w: 0.7, font: 'mono', align: 'right', value: (r) => r.p[0].toFixed(1) },
      { header: 'North', unit: 'km', w: 0.7, font: 'mono', align: 'right', value: (r) => r.p[1].toFixed(1) },
      { header: 'Range', unit: 'km', w: 0.7, font: 'mono', align: 'right', value: (r) => Math.hypot(r.p[0], r.p[1]).toFixed(1) },
    ],
  });
  f.para('Windage contributes a smaller but systematic eastward component; omitting it would displace the reconstructed source by the difference between the dashed and solid traces.', { x: tx, w: tw, size: T.label, color: C.ink2 });
  f.y = Math.max(pyA, f.y);

  const first = recs[0], last = recs[recs.length - 1];
  const d0 = bearingOf(driftVector(first, env.windageFactorPct)), d1 = bearingOf(driftVector(last, env.windageFactorPct));
  f.heading('Interpretation for drift modelling', 60);
  f.list([
    `Wind veered from ${u.bearing(first.windFromDeg)} to ${u.bearing(last.windFromDeg)} (from) and strengthened from ${u.ms(first.windMs, 1)} to ${u.ms(last.windMs, 1)}; values stayed within the SAR slick-detection range throughout.`,
    `Surface current rotated from ${u.bearing(first.currentToDeg)} to ${u.bearing(last.currentToDeg)} (towards). Wind and current were never opposed, so the drift direction is well constrained (${u.bearing(d0)} → ${u.bearing(d1)}).`,
    `The observed slick major axis (${u.bearing(ctx.data.slick.orientationDeg - 180)} / ${u.bearing(ctx.data.slick.orientationDeg)}) lies within ${Math.abs(Math.round(((d1 - (ctx.data.slick.orientationDeg - 180) + 540) % 360) - 180))}° of the modelled T0 drift direction, consistent with advective elongation.`,
    'Forcing is taken from gridded products (0.25° wind, 1/12° current) and does not resolve coastal fronts or tidal jets; see Section 16.',
  ], { size: T.small + 0.3, gap: 3 });
}
