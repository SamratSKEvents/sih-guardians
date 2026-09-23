import type { IapDocument } from '../IapTypes';

/** iap.json — the authoritative machine-readable plan (including the plan graph and comparison snapshot). */
export const renderJson = (doc: IapDocument) => `${JSON.stringify(doc, null, 2)}\n`;
