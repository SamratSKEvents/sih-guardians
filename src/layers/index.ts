import { aisDemoLayer } from './aisDemo';
import { currentsLayer, windLayer } from './flowFields';
import { slicksLayer } from './slicks/slickLayer';
import { heatLayer } from './heatLayer';

/**
 * Register a new layer here. The UI and lifecycle wiring discover it
 * automatically from this ordered list.
 */
export const MAP_LAYERS = [slicksLayer, heatLayer, aisDemoLayer, windLayer, currentsLayer];

export type { MapLayerController } from './types';
export type { SlickTimeMode } from './slicks/slickLayer';
