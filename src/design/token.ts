/** Reads a design token from tokens.css, for canvas/Leaflet/SVG attributes that can't take var(). */
export const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
