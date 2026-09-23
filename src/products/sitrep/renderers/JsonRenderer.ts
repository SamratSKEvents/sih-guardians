import type { SitrepDocument } from '../SitrepTypes';

/** sitrep.json — the machine-readable SITREP. Its `snapshot` is the next SITREP's `previousSitrep.snapshot`. */
export const renderJson = (doc: SitrepDocument) => JSON.stringify(doc, null, 2) + '\n';
