import { aisDemoLayer } from './aisDemo';
import { currentsLayer, windLayer } from './flowFields';
import { slicksLayer } from './slicks/slickLayer';

/**
 * Register a new layer here. The UI and lifecycle wiring discover it
 * automatically from this ordered list.
 */
export const MAP_LAYERS = [slicksLayer, aisDemoLayer, windLayer, currentsLayer];

export type { MapLayerController } from './types';
export type { SlickTimeMode } from './slicks/slickLayer';
