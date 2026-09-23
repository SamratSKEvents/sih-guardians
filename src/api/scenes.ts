/**
 * Scene imagery, for records that carry no investigation bundle.
 *
 * No SAR scenes are bundled for the static catalog, so records without a
 * local incident bundle show an unavailable state without contacting a
 * service.
 */

import type { SarImagery } from '../incidents/types';

export const fetchScene = async (sceneId: string): Promise<SarImagery> => ({
  status: 'UNAVAILABLE',
  reason: 'NO_STATIC_SCENE',
  detail: `No SAR raster is bundled for ${sceneId}. The geometry and measurements are shown from the static demo catalog.`,
});
