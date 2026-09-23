/**
 * DEMONSTRATION / ILLUSTRATIVE DATA.
 * Wires the demo SITREPs into a chain: each update carries the comparable snapshot of the one before.
 * In the integrated system the snapshot is read back from the previous sitrep.json instead.
 */
import type { SitrepIncidentState } from '../SitrepTypes';
import { toPreviousSitrep } from '../analysis/SitrepDeltaEngine';
import { mockSitrep001, mockSitrep002, mockSitrep003 } from './mockSitrepIncident';

export const mockPreviousSitrep = toPreviousSitrep(mockSitrep001);

export const demoSitrepChain: SitrepIncidentState[] = [
  mockSitrep001,
  { ...mockSitrep002, previousSitrep: mockPreviousSitrep },
  { ...mockSitrep003, previousSitrep: toPreviousSitrep(mockSitrep002) },
];
