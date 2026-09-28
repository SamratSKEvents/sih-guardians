"""Download OpenStreetMap coastline around every catalogue slick (Overpass).

Writes tools/coast/raw/<i>.json, one Overpass response per area. Boxes that
overlap are merged first so no coast is fetched twice. Re-running skips areas
already on disk.

    python tools/coast/fetch_coast.py
"""
import json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(ROOT, '..', '..'))
RAW = os.path.join(ROOT, 'raw')
PAD_LAT, PAD_LON = 1.0, 1.1
MIRRORS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter']


def boxes():
    """1 x 1 degree tiles covering a box around every slick; small enough for Overpass to answer."""
    import math
    cat = json.load(open(os.path.join(REPO, 'src', 'data', 'slicks.json'), encoding='utf8'))
    fs = cat['features'] if isinstance(cat, dict) else cat
    tiles = set()
    for f in fs:
        lon, lat = f['properties']['centroid']
        for x in range(math.floor(lon - PAD_LON), math.floor(lon + PAD_LON) + 1):
            for y in range(math.floor(lat - PAD_LAT), math.floor(lat + PAD_LAT) + 1):
                tiles.add((x, y))
    return [[x, y, x + 1, y + 1] for x, y in sorted(tiles)]


def fetch(b):
    q = f'[out:json][timeout:170];way["natural"="coastline"]({b[1]:.3f},{b[0]:.3f},{b[3]:.3f},{b[2]:.3f});out geom;'
    for m in MIRRORS:
        try:
            req = urllib.request.Request(m, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'guardians-sih-demo/1.0'})
            with urllib.request.urlopen(req, timeout=200) as r:
                body = r.read()
            if body.lstrip().startswith(b'{'):
                return body
        except Exception as e:  # try the next mirror
            print('  ', m, e, file=sys.stderr)
    raise RuntimeError(f'no mirror answered for {b}')


if __name__ == '__main__':
    os.makedirs(RAW, exist_ok=True)
    bs = boxes()
    json.dump(bs, open(os.path.join(RAW, 'boxes.json'), 'w'))
    for i, b in enumerate(bs):
        path = os.path.join(RAW, f'{i}.json')
        if os.path.exists(path):
            continue
        body = None
        for attempt in range(3):
            try:
                body = fetch(b)
                break
            except RuntimeError as e:
                print(i, 'retry', attempt + 1, e, file=sys.stderr)
                time.sleep(10 * (attempt + 1))
        if body is None:
            print(i, b, 'SKIPPED: 1:50m land will be used here', file=sys.stderr)
            continue
        open(path, 'wb').write(body)
        print(i, [round(x, 2) for x in b], len(body), 'bytes')
        time.sleep(2)
