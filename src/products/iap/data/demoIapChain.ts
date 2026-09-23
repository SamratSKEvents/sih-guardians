/**
 * DEMONSTRATION / ILLUSTRATIVE DATA.
 * Wires the demo IAPs into a chain: each plan carries the comparable snapshot of the one before.
 * In the integrated system the snapshot is read back from the previous iap.json instead.
 */
import type { IapIncidentState } from '../IapTypes';
import { toPreviousIap } from '../IapGenerator';
import { mockIap001, mockIap002, mockIap003 } from './mockIapIncident';

const iap002: IapIncidentState = { ...mockIap002, previousIap: toPreviousIap(mockIap001) };
const iap003: IapIncidentState = { ...mockIap003, previousIap: toPreviousIap(iap002) };

export const demoIapChain: IapIncidentState[] = [mockIap001, iap002, iap003];
