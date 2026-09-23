# Vendored: the oil engine

A verbatim copy of `oil-imp/packages/engine/src` (the Slick Drift Lab), including
its uncommitted `globe.ts` / `reduced.ts` changes as of 2026-09-21. Zero
dependencies, no DOM — which is what lets `../worker.ts` run it off the main
thread.

The app uses `GlobeMaster` in reduced mode: sparse 64 × 64 blocks that exist
only where the oil is, stopped by the 1:50m land in `public/data/land-50m.json`.
Everything else in here is unused by the app but kept whole so a re-vendor is a
plain copy.

Vendored rather than linked because the source lives outside this repo, on one
machine, and a path dependency on another folder is not a build.

**The environment is synthetic.** The eddies and windrows come from the
model's seed; only the mean wind and current can come from data (`../forcing.ts`).
The UI says so wherever a run is shown.

## Divergence from upstream

None. Configure the model from the worker rather than editing it here, so a
re-vendor stays a copy.
