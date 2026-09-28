/**
 * What the IAP, SITREP and report generators need to know about the open
 * slick. Kept apart from `generate.ts` so the header can hold it without
 * loading the PDF generators until a document is asked for.
 */

export interface ProductContext {
  slickId: string;
  /** Nearest coastal town, and the sea area, for the documents' labels. */
  town: string;
  region: string;
  t0: number;
  centre: { lat: number; lon: number };
  areaKm2: number;
  lengthKm: number;
  driftTowardDeg: number;
  windSpeedMs: number;
  windFromDeg: number;
  currentSpeedMs: number;
  currentTowardDeg: number;
  waveHsM: number;
}

/** The newest context per slick. The Forecast and Response pages refine it with the modelled drift. */
const refined = new Map<string, ProductContext>();
export const setProductContext = (c: ProductContext) => void refined.set(c.slickId, c);
export const productContext = (slickId: string, base: ProductContext) => refined.get(slickId) ?? base;

