"""Download OpenStreetMap intertidal ground for the same tiles as the coastline.

OSM's natural=coastline is the high-water line. Around the Gulf of Kutch and
the Sundarbans most of what is visibly island or shore in imagery is mapped
outside it, as mangrove, tidal flat, salt marsh, mud, sand or beach. That is
also exactly where oil strands. build_land.py merges these into the land.

Writes tools/coast/raw/tidal_<i>.json per tile in raw/boxes.json. Re-running
skips tiles already on disk.

    python tools/coast/fetch_intertidal.py
"""
import json, os, sys, time, urllib.parse, urllib.request

from fetch_coast import MIRRORS, RAW


def fetch(b):
    bb = f'{b[1]:.3f},{b[0]:.3f},{b[3]:.3f},{b[2]:.3f}'
    q = (f'[out:json][timeout:170];('
         f'way["natural"="wetland"]({bb});relation["natural"="wetland"]({bb});'
         f'way["natural"~"^(mud|sand|beach|shoal)$"]({bb});relation["natural"~"^(mud|sand|beach|shoal)$"]({bb});'
         f');out geom;')
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
    boxes = json.load(open(os.path.join(RAW, 'boxes.json')))
    for i, b in enumerate(boxes):
        path = os.path.join(RAW, f'tidal_{i}.json')
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
            print(i, b, 'SKIPPED: coastline only here', file=sys.stderr)
            continue
        open(path, 'wb').write(body)
        print(i, [round(x, 2) for x in b], len(body), 'bytes', flush=True)
        time.sleep(1)
