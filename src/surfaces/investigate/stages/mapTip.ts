/**
 * Hover details for anything on the maps.
 *
 * One card for the whole page, positioned with CSS anchor positioning: a
 * zero-size anchor sits on the map at the pointer, and the card (fixed, on
 * <body>, so no map or pane can clip it) is placed above it with
 * `position-try-fallbacks` flipping it below or sideways at the viewport edge.
 * Browsers without anchor positioning get the same placement from a clamp.
 */

import L from 'leaflet';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Title, optional subtitle, then label/value rows. */
export function card(title: string, sub: string | undefined, rows: [string, string | number | undefined | null][] = []): string {
  const body = rows.filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('');
  return `<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${body ? `<dl>${body}</dl>` : ''}`;
}

const ANCHOR = '--map-tip';
const native = typeof CSS !== 'undefined' && CSS.supports?.('anchor-name', ANCHOR);
let tipEl: HTMLDivElement | undefined;
let anchorEl: HTMLDivElement | undefined;

function ensure(map: L.Map) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'map-tip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  const host = map.getContainer();
  if (!anchorEl || anchorEl.parentElement !== host) {
    anchorEl?.remove();
    anchorEl = document.createElement('div');
    anchorEl.className = 'map-tip-anchor';
    host.appendChild(anchorEl);
  }
}

function place(map: L.Map, at: L.LatLng) {
  if (!tipEl || !anchorEl) return;
  const p = map.latLngToContainerPoint(at);
  anchorEl.style.left = `${p.x}px`;
  anchorEl.style.top = `${p.y}px`;
  if (native) return;
  // Fallback: above the point, flipped below near the top, clamped to the viewport.
  const r = anchorEl.getBoundingClientRect();
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight, gap = 14;
  const top = r.top - h - gap < 8 ? r.top + gap : r.top - h - gap;
  tipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left - w / 2))}px`;
  tipEl.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, top))}px`;
}

export function hover<T extends L.Layer>(layer: T, content: () => string): T {
  let on = false;
  const close = () => { if (on && tipEl) tipEl.hidden = true; on = false; };
  layer.on('mouseover', (e: L.LeafletMouseEvent) => {
    const map = (layer as unknown as { _map?: L.Map })._map;
    if (!map) return;
    ensure(map);
    tipEl!.innerHTML = content();
    tipEl!.hidden = false;
    on = true;
    place(map, e.latlng);
  });
  layer.on('mousemove', (e: L.LeafletMouseEvent) => {
    const map = (layer as unknown as { _map?: L.Map })._map;
    if (on && map) place(map, e.latlng);
  });
  layer.on('mouseout remove', close);
  return layer;
}
