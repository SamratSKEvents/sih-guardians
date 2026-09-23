// @oil/engine — the oil-spill physics, with no renderer, no DOM and no UI.
//
// Two families of model share this package:
//   • Eulerian slick models on a fixed grid (thin film, two-layer shallow water, VOF section, phase field, and the
//     master that combines every non-redundant part). These carry a thickness field and predict how it moves,
//     spreads, ruptures, weathers and strands.
//   • the Lagrangian particle simulation with its curve/surgery machinery, driven by an EnvironmentProvider.
//
// This file is the only entry point: everything below is public API, and everything not listed here is an internal
// that may change. Import from '@oil/engine', never from a deep path.
//
// The engine runs anywhere ES2022 runs — browser, Node, or a worker.

// ---------------------------------------------------------------- the model interface
// Every slick model implements MapModel (a plan view) or SectionModel (a vertical slice); SlickModel is either.
// ParamSpec describes a tunable parameter, so a host can build controls without knowing the model.
export type { Frame, MapModel, SectionModel, SlickModel, ModelInfo, ParamSpec } from './film/grid';
export { Budget, G, RHO_WATER } from './film/grid';

// field helpers: volume of a thickness field, the slick's area/patches/thickness statistics, a disc release
export { volume, fieldSlick, densityGrid, discRelease, evaporatedFraction } from './film/grid';

// ---------------------------------------------------------------- the models
export { ThinFilmModel, THIN_FILM_DEFAULTS, OIL_SPEC, RUPTURE_SPEC, BONN, FilmFlux, oilDrift, slickRows, filmWarnings } from './film/thinfilm';
export type { FilmFluxParams } from './film/thinfilm';
export { TwoLayerModel, CoastalCore, ShelfWater, OilLayer, TWO_LAYER_DEFAULTS, SHELF_SPEC, DEFAULT_COAST, coastX, depthAt } from './film/twolayer';
export type { Coast } from './film/twolayer';
export { MasterModel, MASTER_DEFAULTS, MASTER_SPEC, ENTRAINMENT_TABLE, entrainmentAt } from './film/master';
// the master on sparse blocks: an unbounded open-ocean field that allocates storage only where the oil is
export { SparseMaster } from './film/sparse';
export { SparseReducedMaster } from './film/reduced';
// the same sweeps on several threads, bit-identical (the host provides the transport)
export { SweepPool, createSweepThread } from './film/pool';
export type { ThreadMessage } from './film/pool';
export { rasteriseBlocks, blockKey, finish, BRUTE_DOME_WORK } from './film/raster';
export type { BlockShares } from './film/raster';
export type { SparseParams, SparseProfile } from './film/sparse';
export { GlobeMaster, REFERENCE_SOLVER, OPTIMISED_SOLVER, GLOBE_DEFAULTS, GLOBE_SPEC, GLOBE_INFO, JOIN_M, PLANE_RADIUS_M, MAX_SLICK_M, DISPLAY_MB, bytesPerBlock } from './film/globe';
export { Plane, greatCircleM } from './geo/plane';
export type { PlaneKind } from './geo/plane';
export type { GlobeSolver, GlobeBlock, GlobeRelease, GlobeStroke, GlobeView, LonLat, Workload } from './film/globe';
export { VofModel, VOF_DEFAULTS, breakingShare, seaHeight, vofEntrainment, VOF_TABLE_WINDS } from './film/vof';
export type { VofParams } from './film/vof';
export { PhaseFieldModel, PHASE_DEFAULTS } from './film/phasefield';

// ---------------------------------------------------------------- forcing
// SurfaceFlow is the synthetic surface drift (windage, Langmuir windrows, eddies) the slick models use by default.
// ForcingRegion is a drawn wind or current arrow: the mechanism for overriding the flow over part of the grid.
export { SurfaceFlow, DEFAULT_FLOW, FLOW_SPEC } from './film/flow';
export type { FlowParams, CurrentOverride } from './film/flow';
export { stroke, strokeAt } from './film/shapes';
export type { ForcingRegion, RegionKind } from './film/shapes';

// gridded environment data (winds, currents, Stokes drift, waves, SST) for the particle simulation
export type { EnvironmentProvider, EnvironmentSample } from './env/types';
export { emptySample } from './env/types';
export { GriddedEnvironment } from './env/gridded';
export type { TimeInterp } from './env/gridded';
export { ScenarioEnvironment } from './env/scenario';
export type { ScenarioKind } from './env/scenario';
export { generateEnvironment, DEFAULT_GRID, GEN } from './env/synthetic';
// field indices into a GriddedData slice, for a host that builds or inspects the arrays itself
export { NF, F_WIND_U, F_WIND_V, F_CUR_ROT_U, F_CUR_ROT_V, F_CUR_DIV_U, F_CUR_DIV_V, F_STOKES_U, F_STOKES_V, F_WAVE_H, F_SST } from './env/synthetic';
export type { GriddedData, GridSpec } from './env/synthetic';

// ---------------------------------------------------------------- shapes
// Polygons for drawn slicks and forcing arrows, and the rasteriser that turns one into a per-cell share of volume.
export { polygon, polygonArea, centroid, signedDistance, rasterise } from './film/shapes';
export type { Polygon, SlickProfile } from './film/shapes';

// ---------------------------------------------------------------- the particle simulation
export { Simulation, DEFAULT_PARAMS } from './sim/simulation';
export type { SimParams, Warnings } from './sim/simulation';
export { Particles, seedInsideCurve, STATUS_FLOATING, STATUS_STRANDED } from './particles/particles';
export { weather, DEFAULT_WEATHERING } from './particles/weathering';
export type { WeatheringParams } from './particles/weathering';
export { analyseSlick, analyseSplatSlick, computeDensity, computeSplatField, findPatches, percentileContours, slickFromGrid } from './particles/density';
export type { DensityGrid, SlickState, Patch, PercentileContour } from './particles/density';
export { KERNEL_M, SPLAT_RADIUS_M, SPLAT_THRESHOLD, PATCH_MIN_CELLS, PATCH_MIN_AREA_FRACTION, PATCH_MIN_MASS_FRACTION } from './particles/density';
export { VelocityField, integrate } from './sim/integrator';
export type { IntegratorKind, ForcingParams } from './sim/integrator';
export { PlaybackClock, PLAYBACK_SPEEDS } from './sim/clock';

// curve geometry: the slick outline the particle model carries, and the surgery that splits it when it pinches
export { initialCurve, projectCurve, resampleCurve, computeMetrics, pointInPolygon, shoelace } from './curve/curve';
export type { Curve, CurveMetrics } from './curve/curve';
export { surgery } from './curve/surgery';
export type { SurgeryResult } from './curve/surgery';

// ---------------------------------------------------------------- utilities
// Local tangent-plane geodesy: the models work in metres east/north of a frame origin, hosts usually in lon/lat.
export { toLocal, fromLocal, displace, localDistance, safeCos, wrapLon, clampLat, EARTH_RADIUS_M, DEG } from './geo/geodesy';
// Real-to-complex FFT used by the phase-field solver; exported because it is generally useful and is tested.
export { fft, fft2 } from './film/fft';
// Seeded PRNG: every model is deterministic given its seed, so a prediction can be reproduced exactly.
export { Rng, subSeed } from './rng/prng';
export { OceanMaster, needsOcean, OCEAN_TOLERANCE } from './film/ocean';
export type { OceanAccuracy } from './film/ocean';
export { oceanArea, oceanDomain, oceanReleaseProblem } from './film/ocean-release';
export { SphereTransport } from './film/sphere';
export type { SphereDomain, OceanVelocity } from './film/sphere';
