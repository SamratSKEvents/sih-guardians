"""Optical (EO) cross-check: a Sentinel-2 true-colour crop around every catalogue slick.

Searches Microsoft Planetary Computer (open, no key) for Sentinel-2 L2A passes
within ±DAYS of the SAR detection over the slick, picks the pass nearest in time
among those under MAX_CLOUD % cloud, and saves a cropped true-colour JPEG plus
its metadata to public/data/eo/. The app shows it next to the SAR scene.

    python tools/eo/fetch_eo.py
"""
import io, json, os, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(ROOT, '..', '..'))
OUT = os.path.join(REPO, 'public', 'data', 'eo')
RAW = os.path.join(ROOT, 'raw')  # per-tile crops; tools/eo/composite.cjs merges them into OUT
STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
DATA = 'https://planetarycomputer.microsoft.com/api/data/v1/item/bbox'
DAYS, MAX_CLOUD, PAD = 5, 40, 0.06


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'guardians-sih-demo/1.0'}), timeout=180) as r:
        return r.read()


def bbox_of(geom):
    pts = []
    def walk(c):
        if isinstance(c[0], (int, float)): pts.append(c)
        else:
            for x in c: walk(x)
    walk(geom['coordinates'])
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    # Square-ish crop, padded, never smaller than ~13 km.
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    half = max(max(xs) - min(xs), max(ys) - min(ys)) / 2 + PAD
    return [cx - half, cy - half, cx + half, cy + half]


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(RAW, exist_ok=True)
    cat = json.load(open(os.path.join(REPO, 'src', 'data', 'slicks.json'), encoding='utf8'))
    fs = cat['features'] if isinstance(cat, dict) else cat
    index_path = os.path.join(OUT, 'index.json')
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    for f in fs:
        p = f['properties']
        sid = f.get('id') or p.get('id')
        if sid in index: continue
        t0 = datetime.fromisoformat(str(p['observedAt']).replace('Z', '+00:00'))
        if t0.tzinfo is None: t0 = t0.replace(tzinfo=timezone.utc)
        bb = bbox_of(f['geometry'])
        span = f"{(t0 - timedelta(days=DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ')}/{(t0 + timedelta(days=DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ')}"
        try:
            items = post(STAC, {'collections': ['sentinel-2-l2a'], 'bbox': bb, 'datetime': span, 'limit': 50}).get('features', [])
        except Exception as e:
            print(sid, 'search failed', e, file=sys.stderr); continue
        found = len(items)
        items = [i for i in items if (i['properties'].get('eo:cloud_cover') or 0) <= MAX_CLOUD]
        if not items:
            index[sid] = {'status': 'NONE', 'searched': span, 'found': found, 'maxCloud': MAX_CLOUD}
            print(sid, 'no pass under', MAX_CLOUD, '% cloud of', found)
            json.dump(index, open(index_path, 'w'), indent=1); continue
        dt = lambda i: abs((datetime.fromisoformat(i['properties']['datetime'].replace('Z', '+00:00')) - t0).total_seconds())
        best = min(items, key=lambda i: (dt(i), i['properties'].get('eo:cloud_cover') or 0))
        # Every tile of the same pass: a crop can straddle a Sentinel-2 tile edge.
        same = [i for i in items if i['properties']['datetime'][:16] == best['properties']['datetime'][:16]]
        parts = []
        for k, it in enumerate(same):
            q = urllib.parse.urlencode({'collection': 'sentinel-2-l2a', 'item': it['id'], 'assets': 'visual', 'asset_bidx': 'visual|1,2,3', 'nodata': 0, 'width': 768, 'height': 768})
            try:
                png = get(f"{DATA}/{bb[0]:.4f},{bb[1]:.4f},{bb[2]:.4f},{bb[3]:.4f}.png?{q}")
            except Exception as e:
                print(sid, it['id'], 'crop failed', e, file=sys.stderr); continue
            part = os.path.join(RAW, f"{sid.replace(':', '_')}_{k}.png")
            open(part, 'wb').write(png)
            parts.append(part)
        if not parts: continue
        name = sid.replace(':', '_') + '.jpg'
        bt = datetime.fromisoformat(best['properties']['datetime'].replace('Z', '+00:00'))
        index[sid] = {
            'status': 'AVAILABLE', 'file': f'/data/eo/{name}', 'item': best['id'], 'platform': best['properties'].get('platform'),
            'datetime': best['properties']['datetime'], 'offsetH': round((bt - t0).total_seconds() / 3600, 1),
            'cloud': round(best['properties'].get('eo:cloud_cover') or 0, 2), 'bbox': [round(x, 5) for x in bb], 'found': found, 'parts': parts, 'tiles': [i['id'] for i in same],
        }
        print(sid, best['id'], index[sid]['offsetH'], 'h', index[sid]['cloud'], '% cloud')
        json.dump(index, open(index_path, 'w'), indent=1)
