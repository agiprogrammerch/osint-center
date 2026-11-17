#!/usr/bin/env python3
"""
Offline map downloader for VOID//MATRIX — free, no key, no accounts.

    python3 download_istanbul_map.py                 # recommended preset
    python3 download_istanbul_map.py --preset quick  # small & fast
    python3 download_istanbul_map.py --preset full   # everything
    python3 download_istanbul_map.py --bbox 51.4,-0.15,51.6,0.05 --zoom 8-14 -l maps/london

Tiles land in  <folder>/{z}/{x}/{y}.png  plus a  manifest.json  that the app
reads to enable the offline basemap with correct bounds and zoom limits.

Sources are free public tile servers (all key-less):
    osm-de    (default — German OSM mirror, tolerates polite bulk use)
    osm       (official OpenStreetMap servers — 403-blocks bulk downloads)
    topo      (OpenTopoMap terrain)
    esri-sat  (Esri World Imagery satellite)

Only the Python standard library is used. The download resumes: existing
tiles are skipped, so you can stop (Ctrl+C) and continue later. Size
estimates are measured from tiles already on disk when you resume.
"""

import argparse
import concurrent.futures as futures
import hashlib
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (compatible; VoidMatrix-OSINT/3.0; offline-map-download)"
TIMEOUT = 30
WORKERS = 3                 # polite concurrency (respect the tile policy)
DELAY = 0.20                # seconds between requests per worker
CAP = 500000                 # hard safety cap

# All sources are FREE and need NO API key. (Carto basemaps were removed:
# they now return an "API KEY REQUIRED" placeholder tile instead of maps.)
#   "filter": how the app should render them (dark = inverted for the CRT theme)
SOURCES = {
    "osm-de":     {"url": "https://tile.openstreetmap.de/{z}/{x}/{y}.png",      "filter": "dark",
                   "note": "German OSM mirror — default, tolerates polite bulk use"},
    "osm":        {"url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",    "filter": "dark",
                   "note": "official servers — 403-blocks bulk downloads"},
    "topo":       {"url": "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",    "filter": "light",
                   "note": "terrain"},
    "esri-sat":   {"url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "filter": "none",
                   "note": "satellite imagery"},
}
DEFAULT_SOURCE = "osm-de"

# Istanbul areas: (south, west, north, east)
ISTANBUL_METRO = (40.75, 28.45, 41.35, 29.55)
ISTANBUL_CORE  = (40.95, 28.80, 41.20, 29.25)

PRESETS = {
    # name: (description, [(bbox, zoom_from, zoom_to), ...])
    "quick":    ("~2.4k tiles — metro overview + city-core detail (default)", [
                     (ISTANBUL_METRO, 0, 13),
                     (ISTANBUL_CORE,  14, 15)]),
    "standard": ("~7.6k tiles — metro overview + full city-core detail", [
                     (ISTANBUL_METRO, 0, 13),
                     (ISTANBUL_CORE,  10, 16)]),
    "full":     ("~425k tiles — Istanbul at every zoom (z0-z19)", [
                     (ISTANBUL_METRO, 0, 13),
                     (ISTANBUL_CORE,  10, 19)]),
}
# ---------------------------------------------------------------- tile math
def lon_to_x(lon, z):
    return int((lon + 180.0) / 360.0 * (2 ** z))

def lat_to_y(lat, z):
    r = math.log(math.tan(math.pi / 4 + (lat * math.pi / 180) / 2))
    return int((1 - r / math.pi) / 2 * (2 ** z))

def tile_list(bbox, z_from, z_to):
    s, w, n, e = bbox
    for z in range(z_from, z_to + 1):
        x0, x1 = lon_to_x(w, z), lon_to_x(e, z)
        y0, y1 = lat_to_y(n, z), lat_to_y(s, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                yield (z, x, y)

def avg_tile_bytes(folder, default=30000, samples=300):
    """Average size of tiles already on disk, so a resumed run reports the
    real footprint instead of a generic guess."""
    if not folder or not os.path.isdir(folder):
        return default
    sizes = []
    for dp, _, fs in os.walk(folder):
        for f in fs:
            if f.endswith(".png"):
                try:
                    sizes.append(os.path.getsize(os.path.join(dp, f)))
                except OSError:
                    pass
        if len(sizes) >= samples:
            break
    return (sum(sizes) / len(sizes)) if sizes else default


def estimate(regions, folder=None):
    total, mb = 0, 0.0
    per = avg_tile_bytes(folder) / (1024.0 * 1024.0)      # MB per tile
    for bbox, z0, z1 in regions:
        cnt = sum(1 for _ in tile_list(bbox, z0, z1))
        total += cnt
        mb += cnt * per
    return total, mb

# ---------------------------------------------------------------- download
def tile_url(source, z, x, y):
    return SOURCES[source]["url"].format(z=z, x=x, y=y)

def fetch_tile(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()

def download(source, folder, jobs, total):

    done = ok = skipped = failed = 0
    t0 = time.time()
    per_worker_last = [0.0] * WORKERS
    seen_tiles = {}                # md5 -> count  (placeholder detection)
    top_size = {}                  # md5 -> bytes
    placeholder = [False]          # list so the nested worker can set it

    def one(idx, t):
        z, x, y = t
        path = os.path.join(folder, str(z), str(x), f"{y}.png")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return "skip"
        if idx is not None:
            gap = time.time() - per_worker_last[idx]
            if gap < DELAY:
                time.sleep(DELAY - gap)
            per_worker_last[idx] = time.time()
        tmp = path + ".part"
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        for attempt in range(3):
            try:
                data = fetch_tile(tile_url(source, z, x, y))
                if data[:4] not in (b"\x89PNG", b"\xff\xd8\xff"):
                    raise ValueError("not an image (placeholder/watermark?)")
                with open(tmp, "wb") as f:
                    f.write(data)
                os.replace(tmp, path)
                h = hashlib.md5(data).hexdigest()
                seen_tiles[h] = seen_tiles.get(h, 0) + 1
                top_size[h] = len(data)
                n = sum(seen_tiles.values())
                if n >= 20 and n % 10 == 0:
                    top = max(seen_tiles, key=seen_tiles.get)
                    share = seen_tiles[top] / n
                    # >90% identical, and the identical tile is a real image
                    # size (>=1 KB): that is a "blocked"/watermark service.
                    if share > 0.9 and top_size[top] >= 1000:
                        placeholder[0] = True
                        return "placeholder"
                return "ok"
            except urllib.error.HTTPError as e:
                if e.code in (404, 410):          # tile genuinely absent
                    open(path, "wb").close()
                    return "skip"
                if e.code == 429:
                    time.sleep(3 + attempt * 3)   # rate limited: back off
                else:
                    time.sleep(1.5 * (attempt + 1))
            except Exception:                      # noqa: BLE001
                time.sleep(1.5 * (attempt + 1))
        return "fail"

    def report():
        bar = f"\r  {ok + skipped} / {total} tiles  ({ok} new, {skipped} cached, {failed} failed)"
        sys.stdout.write(bar)
        sys.stdout.flush()

    with futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        pending = set()
        it = iter(jobs)
        try:
            while True:
                while len(pending) < WORKERS * 4:
                    try:
                        t = next(it)
                    except StopIteration:
                        break
                    idx = len(pending) % WORKERS
                    pending.add(pool.submit(one, idx, t))
                if not pending:
                    break
                for fut in futures.as_completed(pending):
                    r = fut.result()
                    pending.discard(fut)
                    if r == "ok":
                        ok += 1
                    elif r == "skip":
                        skipped += 1
                    elif r == "placeholder":
                        placeholder[0] = True
                    done += 1
                    if done % 25 == 0 or done == total:
                        report()
                    break
                if placeholder[0]:
                    break
        except KeyboardInterrupt:
            sys.stdout.write("\n  interrupted — partial download kept on disk, rerun to continue\n")
            pool.shutdown(wait=False, cancel_futures=True)
            return {"ok": ok, "skipped": skipped, "failed": failed, "placeholder": placeholder[0]}

    if placeholder[0]:
        pool.shutdown(wait=False, cancel_futures=True)

    sys.stdout.write(f"\n  done in {(time.time()-t0)/60:.1f} min — {ok} new, {skipped} cached, {failed} failed\n")
    return {"ok": ok, "skipped": skipped, "failed": failed, "placeholder": placeholder[0]}

def dir_size(folder):
    return sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(folder) for f in fs if f.endswith(".png"))


def write_manifest(folder, source, regions, stats):
    man = {
        "name": os.path.basename(folder).replace("_", " ").title(),
        "source": source,
        "filter": SOURCES[source]["filter"],
        "tileUrl": "{z}/{x}/{y}.png",
        "bbox": [min(r[0][0] for r in regions), min(r[0][1] for r in regions),
                 max(r[0][2] for r in regions), max(r[0][3] for r in regions)],
        "minZoom": min(r[1] for r in regions),
        "maxZoom": max(r[2] for r in regions),
        "tiles": stats.get("tiles", 0),
        "downloadedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "bytes": stats.get("bytes") or 0,
    }
    with open(os.path.join(folder, "manifest.json"), "w") as f:
        json.dump(man, f, indent=1)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Download a free offline map for VOID//MATRIX.")
    ap.add_argument("--preset", default="quick", choices=list(PRESETS))
    ap.add_argument("--source", default=DEFAULT_SOURCE, choices=list(SOURCES),
                    help="tile source (default: %(default)s)")
    ap.add_argument("--bbox", help="south,west,north,east  (overrides --preset)")
    ap.add_argument("--zoom", help="z0-z1  (overrides --preset's zoom range)")
    ap.add_argument("-l", "--label", default="istanbul", help="folder name under maps/")
    ap.add_argument("--out", default=None, help="explicit output folder (overrides maps/<label>)")
    args = ap.parse_args()

    if args.bbox:
        try:
            s, w, n, e = [float(v) for v in args.bbox.split(",")]
        except Exception:
            ap.error("--bbox must be south,west,north,east")
        z0, z1 = (14, 15)
        if args.zoom:
            a, b = args.zoom.split("-")
            z0, z1 = int(a), int(b)
        regions = [((s, w, n, e), z0, z1)]
        label = args.label or "custom"
    else:
        desc, regions = PRESETS[args.preset]
        label = args.label
        print(f"  preset: {args.preset} — {desc}")

    folder = args.out or os.path.join("maps", label)
    os.makedirs(folder, exist_ok=True)
    total, mb = estimate(regions, folder)
    if total > CAP:
        ap.error(f"that would be {total} tiles — above the {CAP} safety cap; lower the zoom")

    print(f"  source : {args.source} ({SOURCES[args.source]['url']})")
    print(f"  target : {os.path.abspath(folder)}")
    print(f"  tiles  : {total} (~{mb:.1f} MB on disk)")
    print(f"  note   : {SOURCES[args.source]['note']}")
    zooms = sorted({z for (_, z0, z1) in regions for z in range(z0, z1 + 1)})
    print("  zoom   : " + ", ".join("z%d" % z for z in zooms))
    print("  start  : existing tiles are skipped, so this is resumable\n")

    # Seed a manifest only for a brand-new folder: overwriting it here
    # would destroy the real tile counts a resume depends on.
    if not os.path.exists(os.path.join(folder, "manifest.json")):
        write_manifest(folder, args.source, regions, {"tiles": 0, "bytes": 0})
    stats = download(args.source, folder, (t for r in regions for t in tile_list(*r)), total)
    stats["tiles"] = stats.get("ok", 0) + stats.get("skipped", 0)
    stats["bytes"] = dir_size(folder)
    if stats.get("placeholder"):
        print("\n  ABORTED: this source is serving a placeholder image, not a map.")
        print("  Try another --source (osm, osm-de, topo or esri-sat).")
        return 2
    write_manifest(folder, args.source, regions, stats)

    print(f"\n  wrote {os.path.join(folder, 'manifest.json')}")
    print(f"  open http://127.0.0.1:8000 — the 'ISTANBUL OFFLINE' basemap is now available")
    print("  (press B to cycle basemaps, or use the map control)")

if __name__ == "__main__":
    main()
