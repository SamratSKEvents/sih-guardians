import type { Viewer } from 'cesium';

/** Context shared by every independently registered map layer. */
export interface MapLayerContext {
  viewer: Viewer;
}

/** Runtime handle returned by a layer after it creates its Cesium primitives. */
export interface MapLayerController {
  setVisible(visible: boolean): void;
  setFocus?(entityId: string | undefined): void;
  /** The page clock, in epoch ms. Called on creation and whenever time moves. */
  setTime?(timeMs: number): void;
  /**
   * What the clock should DO to this layer: show everything, fade what is not
   * current, or show only what is current. Only layers with dated features
   * implement it. See SlickTimeMode for the values.
   */
  setTimeMode?(mode: string): void;
  /**
   * The filter rail's date window in epoch ms, [start, end), or undefined for
   * no date filter. Independent of the clock: both narrow the same layer.
   */
  setDateRange?(range: [number, number] | undefined): void;
  /** The rail's area window in km², [min, max]; max undefined means no upper bound. */
  setAreaRange?(range: [number, number | undefined] | undefined): void;
  /** The rail's source filters as a per-slick test; undefined passes every slick. */
  setSlickFilter?(test: ((slickId: string) => boolean) | undefined): void;
  destroy(): void;
}

/**
 * Additive layer contract.
 *
 * A layer owns the primitives it creates. The map shell only creates it,
 * toggles visibility, and destroys it during viewer teardown.
 */
export interface MapLayerDefinition {
  id: string;
  label: string;
  description: string;
  /**
   * The one figure worth knowing about the layer WITHOUT turning it on,
   * right-aligned in the legend's own column.
   *
   * Without it the operator has to toggle a layer to find out what is behind
   * it, which is the failure the legend exists to prevent. It is not the same
   * quantity for every layer — a detection layer is a count, a forcing field
   * is a cadence — so the description carries the unit and the column is
   * never ambiguous.
   *
   * These are static descriptors today. They become live counts when the
   * layers can report what is actually in view.
   */
  value: string;
  /** Which `LayerSwatch` draws it, so the legend shows how the layer looks. */
  swatch: string;
  defaultVisible: boolean;
  create(context: MapLayerContext): MapLayerController;
}
