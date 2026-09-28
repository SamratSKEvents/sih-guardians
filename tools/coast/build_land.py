"""Build public/data/land-hires.json: OSM land inside the fetched tiles, 1:50m land elsewhere.

OSM coastline ways run with land on their LEFT. Per tile: clip the coastline to
the tile, polygonise it together with the tile edge, then call each face land or
water by voting: points just left of a coastline segment are land, just right
are water. Faces no coastline touches (open sea, deep inland) take the 1:50m
answer at their centre.

Then the intertidal ground (fetch_intertidal.py: mangrove, tidal flat, salt
marsh, mud, sand, beach) is merged in. OSM's coastline is the high-water line,
so without it the Gulf of Kutch islands are drawn as their dry cores only.

    python tools/coast/build_land.py
"""
import json, os, math
from shapely.geometry import LineString, Point, Polygon, box, shape, mapping
from shapely.ops import linemerge, polygonize, unary_union
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(ROOT, '..', '..'))
RAW = os.path.join(ROOT, 'raw')
OUT = os.path.join(REPO, 'public', 'data', 'land-hires.json')
EPS = 2e-5  # ~2 m, the offset for the land/water probes
SIMPLIFY = 0.00015  # ~15 m; keeps the file small, far below the model's 50 m cells


def topo_rings(path):
    t = json.load(open(path, encoding='utf8'))
    sc, tr = t['transform']['scale'], t['transform']['translate']
    arcs = []
    for a in t['arcs']:
        x = y = 0
        pts = []
        for dx, dy in a:
            x += dx; y += dy
            pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
        arcs.append(pts)

    def ring(refs):
        out = []
        for r in refs:
            part = arcs[r] if r >= 0 else arcs[~r][::-1]
            out.extend(part if not out else part[1:])
        return out

    polys = []
    def walk(o):
        if o['type'] == 'GeometryCollection':
            for g in o['geometries']: walk(g)
        elif o['type'] == 'Polygon':
            rs = [ring(r) for r in o['arcs']]
            if len(rs[0]) >= 4: polys.append(Polygon(rs[0], [r for r in rs[1:] if len(r) >= 4]).buffer(0))
        elif o['type'] == 'MultiPolygon':
            for p in o['arcs']:
                rs = [ring(r) for r in p]
                if len(rs[0]) >= 4: polys.append(Polygon(rs[0], [r for r in rs[1:] if len(r) >= 4]).buffer(0))
    walk(t['objects']['land'])
    return polys


def tile_land(tile, ways, coarse_tree, coarse):
    b = box(*tile)
    lines = []
    for w in ways:
        g = w.get('geometry')
        if not g or len(g) < 2: continue
        ls = LineString([(p['lon'], p['lat']) for p in g])
        if ls.intersects(b): lines.append(ls)
    def coarse_land(pt):
        return any(coarse[i].contains(pt) for i in coarse_tree.query(pt))
    if not lines:
        # No coast in the tile: all land or all sea.
        return [b] if coarse_land(b.centroid) else []
    clipped = [ls.intersection(b) for ls in lines]
    noded = unary_union([g for g in clipped if not g.is_empty] + [b.exterior])
    faces = list(polygonize(noded))
    tree = STRtree(faces)
    votes = [0] * len(faces)
    for ls in lines:
        cs = list(ls.coords)
        step = max(1, len(cs) // 400)
        for i in range(0, len(cs) - 1, step):
            (x1, y1), (x2, y2) = cs[i], cs[i + 1]
            dx, dy = x2 - x1, y2 - y1
            n = math.hypot(dx, dy)
            if n == 0: continue
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            lx, ly = -dy / n * EPS, dx / n * EPS
            for pt, v in ((Point(mx + lx, my + ly), 1), (Point(mx - lx, my - ly), -1)):
                if not b.contains(pt): continue
                for k in tree.query(pt):
                    if faces[k].contains(pt):
                        votes[k] += v
                        break
    land = []
    for f, v in zip(faces, votes):
        if v > 0 or (v == 0 and coarse_land(f.representative_point())):
            land.append(f)
    return land


def tidal_polys(path, tile):
    """Areas from one fetch_intertidal.py response, clipped to the tile."""
    if not os.path.exists(path): return []
    b = box(*tile)
    line = lambda g: LineString([(p['lon'], p['lat']) for p in g]) if g and len(g) >= 2 else None
    out = []
    for e in json.load(open(path, encoding='utf8')).get('elements', []):
        if e['type'] == 'way':
            g = e.get('geometry') or []
            if len(g) >= 4 and g[0] == g[-1]:
                out.append(Polygon([(p['lon'], p['lat']) for p in g]).buffer(0))
        elif e['type'] == 'relation':
            parts = {'outer': [], 'inner': []}
            for m in e.get('members', []):
                l = line(m.get('geometry')) if m.get('type') == 'way' else None
                if l is not None: parts['inner' if m.get('role') == 'inner' else 'outer'].append(l)
            if not parts['outer']: continue
            outer = unary_union([p.buffer(0) for p in polygonize(linemerge(parts['outer']))])
            inner = unary_union([p.buffer(0) for p in polygonize(linemerge(parts['inner']))]) if parts['inner'] else None
            out.append(outer.difference(inner) if inner is not None else outer)
    return [g.intersection(b) for g in out if not g.is_empty and g.intersects(b)]


def rings_of(g):
    if g.is_empty: return []
    geoms = [g] if g.geom_type == 'Polygon' else list(getattr(g, 'geoms', []))
    out = []
    for p in geoms:
        if p.geom_type != 'Polygon' or p.area < 1e-7: continue
        out.append([[round(x, 5), round(y, 5)] for x, y in p.exterior.coords])
        # ponytail: holes (lagoons, lakes) are emitted as land-free by dropping them; the engine takes
        # filled rings. Carve holes into rings if inland water ever matters to a run.
    return out


if __name__ == '__main__':
    tiles = json.load(open(os.path.join(RAW, 'boxes.json')))
    coarse = topo_rings(os.path.join(REPO, 'public', 'data', 'land-50m.json'))
    coarse_tree = STRtree(coarse)
    hires = []
    done = []
    for i, t in enumerate(tiles):
        path = os.path.join(RAW, f'{i}.json')
        if not os.path.exists(path):
            print('missing tile', i, t); continue
        ways = json.load(open(path, encoding='utf8')).get('elements', [])
        land = tile_land(t, ways, coarse_tree, coarse)
        tidal = tidal_polys(os.path.join(RAW, f'tidal_{i}.json'), t)
        hires.extend(land + tidal)
        done.append(t)
        print(i, t, len(ways), 'ways ->', len(land), 'land faces +', len(tidal), 'intertidal')
    # Only tiles actually fetched replace the 1:50m land.
    covered = unary_union([box(*t) for t in done])
    hires_u = unary_union(hires).simplify(SIMPLIFY, preserve_topology=True)
    # Outside the fetched tiles, the 1:50m land as before.
    outside = [p.difference(covered) for p in coarse]
    rings = []
    for g in [hires_u] + outside:
        rings.extend(rings_of(g))
    json.dump({'source': 'OpenStreetMap coastline + intertidal ground (ODbL) inside tiles; Natural Earth 1:50m elsewhere', 'tiles': done, 'rings': rings}, open(OUT, 'w'), separators=(',', ':'))
    print('rings', len(rings), 'bytes', os.path.getsize(OUT))
