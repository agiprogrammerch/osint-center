# VOID//MATRIX — OSINT Command Center (v1.0)
# Agi Hacker

A browser-based OSINT dashboard: live aircraft, earthquakes, natural disasters,
conflict zones, maritime zones, botnet C2 servers, satellites, live public
cameras and a news ticker — all on a dark CRT map.

**100% free. No API keys, no accounts, no npm install, no build step.**
Everything runs from Python 3's standard library + public data APIs.

---

## Run it

```bash
cd "/path/to/OSINT Center"
python3 serve.py            # then open http://127.0.0.1:8000
```

Optional: `python3 serve.py --port 8080`

Login (themed gate, client-side only): `agiprogrammer` / `Hacker@11`

> `serve.py` does two jobs: it serves the page **and** provides the `/proxy`
> endpoint that all live feeds use. Opening `index.html` directly (file://)
> will not load live data — the app shows a warning banner if that happens.

---

## What the panels show

| Tab | Source | Notes |
|---|---|---|
| OVERVIEW | BBC · Al Jazeera · Guardian · DW · NPR | RSS, parsed locally via the proxy |
| AIR TRAFFIC | OpenSky Network (OAuth or anonymous) | **Registration, model, manufacturer, owner, operator, country** via free key-less lookups (hexdb.io + api.adsb.lol), plus altitude (baro/geo), vertical rate, ground speed, heading, squawk and position age. Search covers callsign/ICAO/registration/type |
| CYBER | SANS ISC/DShield + abuse.ch Feodo | **Live attack origins** (60) with IP, geolocation (country/city/AS/ISP), attack events, packet counts, first/last reported, the services being attacked right now and real target counts — each origin is physically marked on the map with a pulsing pin sized by attack volume. Plus the live **targeted services** list (SSH/RDP/HTTP-proxy/IoT…) and the **botnet C2 indicators**. |
| DISASTERS | USGS earthquakes + NASA EONET | **Full detail on both**: quakes show PAGER alert, MMI/CDI shaking, felt reports, significance, tsunami flag, mag type, station/quality metrics, timestamps and a link to the USGS event page; events show real category, magnitude (burned acres / wind speed), description, source name + link and the drawn movement track. Filters are built from the categories actually present. |
| CCTV | TfL JamCams (London) | ~800 live public cameras; stills refresh every 5s, or switch to the `.mp4` stream |
| MARITIME | Digitraffic AIS (Baltic) | Real vessels with **name, MMSI, IMO, callsign, flag country (decoded from the MMSI MID — 292 ITU codes), type (ITU ship codes), dimensions (LOA × beam), speed, course/heading, nav status, destination + destination country (UN/LOCODE), decoded AIS ETA, draught, position age**. **Military & government vessels** (NATO warships, Finnish Navy, law enforcement) are detected from AIS ship type 35/55 + naming and get their own marker, filter and details |

Map layers (legend toggles): flights, military, ships, conflicts, quakes,
fires/disasters, cyber, satellites, CCTV. Click a legend chip to show/hide,
**double-click** to fly to that layer's data. The map's HUD (bottom right) shows
measured FPS, object count and coordinate format.

---

## File layout

```
OSINT Center/
├── index.html              app shell
├── serve.py                local server + /proxy  (python3 stdlib only)
├── README.md
├── css/
│   ├── base.css            theme variables, reset, primitives, animations
│   ├── shell.css           login, loader, header, ticker, nav, layout
│   ├── panels.css          right-hand panels: rows, toolbar, chips, news
│   ├── map.css             map, legend, coordinate tooltip, Leaflet skin
│   └── modal.css           CCTV viewer modal + proxy warning
└── js/
    ├── main.js             entry point: boot, action dispatch, schedulers
    ├── config.js           endpoints, refresh cadence, limits
    ├── state.js            shared state + marker registry
    ├── utils.js            proxy-aware HTTP, DOM helpers, formatters
    ├── map/
    │   ├── init.js         Leaflet setup, satellite view, coord tooltip
    │   └── markers.js      panel row → map marker focusing
    ├── feeds/              one file per data source
    │   ├── flights.js  quakes.js  disasters.js  conflicts.js
    │   ├── maritime.js cyber.js   news.js       satellites.js  cctv.js
    ├── ui/
    │   ├── login.js  clock.js  ticker.js  eventLog.js
    │   ├── legend.js tabs.js   session.js
    │   └── panels/           panel renderers (registry + kit + 5 panels)
    └── data/
        └── statics.js        zones, prefixes, centroids, TLE fallback
```

The browser code is native ES modules (`type="module"`), so it must be served
over HTTP (that's what `serve.py` is for). No bundler needed.

---

## Aircraft detail (all free, no keys)

OpenSky's state vectors only carry position/flight data. On top of that the app
enriches each aircraft with:

| Field | Where it comes from |
|---|---|
| Registration, model, manufacturer, owner, type code | **hexdb.io** + **api.adsb.lol** (free, key-less, cached 30 days in `localStorage`) |
| Operator (`DLH458` → Lufthansa) | decoded **offline** from the callsign prefix — ~100 airlines + military callsigns |
| Model name (`A20N` → Airbus A320neo, `B38M` → 737 MAX 8) | decoded **offline** from the ICAO type code — ~150 types |
| Country of registration | OpenSky itself |
| Altitude (baro + geo), vertical rate, ground speed, heading, squawk, position age | OpenSky itself |

Behaviour:
* The first **30 military aircraft** are prefetched on each flight refresh.
* The panel then enriches the **first 40 rows you're looking at**, one lookup
  every 700 ms (respecting the providers' ~1 req/s guidance), so rows fill in
  progressively as you scroll or re-sort.
* Clicking any row enriches it immediately and refreshes its open popup.
* Panel meta shows `ID'D: n/total`; misses are cached too (2 h for "not in any
  database", 10 min for a temporary failure) so a rate-limit never hammers.

## Free-tier etiquette (already configured)

* OpenSky anonymous access is capped around **400 requests/day** — the app
  refreshes flights every **5 minutes** (~288/day) to stay well inside that.
* SANS ISC / DShield attack telemetry, ip-api.com geolocation, USGS, EONET,
  CelesTrak, Feodo, TfL and the RSS feeds are free for reasonable use; refresh
  intervals are 2.5–15 minutes.
* The proxy runs entirely on your machine; no third-party proxy sees the
  traffic.

## Map system

The map was rebuilt as a small module set under `js/map/`:

| Module | Responsibility |
|---|---|
| `engine.js` | Leaflet instance, panes, basemaps (Carto dark/voyager + Esri satellite) |
| `layers.js` | Layer registry — visibility, clustering policy, zoom-to-data |
| `perf.js` | Frame-time monitor; clusters harder when frames get slow |
| `controls.js` | Zoom stack, scale bar, overlay toggles, keyboard shortcuts |
| `overlays.js` | 10° graticule + real solar day/night terminator |
| `coords.js` | Live lat/lng readout in DD or DMS, click to copy |

**Controls** (right side, top→bottom): zoom in / out · reset view · zoom to top
layer · graticule `G` · day/night terminator `N` · crosshair `C` · coordinate
format `M` · basemap style `B` · fullscreen `F`.
**Keyboard**: `+`/`-` zoom · arrows pan · `R` reset · `G` graticule · `N` night · `C` crosshair · `M` DD/DMS · `B` basemap · `F` fullscreen · `Z` zoom to layer.
**Legend**: click a chip to show/hide a layer, **double-click** to fly to its data.
**HUD** (bottom of the map): measured FPS, live object count, coordinate format.
**Search bar** (top-left of the map, or press `/`): type coordinates and the map
flies there and drops a pulsing pin with the position in both decimal and DMS.
Accepted formats: `51.5074, -0.1278` · `51.5074 -0.1278` · `51.5074N 0.1278W` ·
`51°30'27.1"N 0°07'39.7"W` · `51 30 27 N 0 07 39 W` · `0, 0`.
Anything that isn't a coordinate is looked up as a **place name** via
OpenStreetMap Nominatim (free, key-less) and shown as a clickable result list.

**Basemaps** (press `B` or the ▤ control to cycle): `OSM DARK` (OpenStreetMap
tiles inverted for the dark CRT theme) · `OSM` (classic) · `TOPO`
(OpenTopoMap terrain) · `ISTANBUL OFFLINE` (if downloaded) · and `🛰 SAT VIEW`
in the header for Esri satellite imagery. **All are free and need no API key**
— Carto was removed after it started serving an "API KEY REQUIRED" placeholder
tile instead of maps.

**Layout on 1366x786 (or any screen)**: the side panels auto-narrow below
1440px and 1200px — on 1366x786 the map gets **864px** instead of 780px, and
cluster icons shrink so they don't dominate. `◧ PANELS` in the header (or the
`P` key) collapses both panels for a **full-width 1366px map**; the choice is
remembered across sessions.

The day/night overlay is real astronomy — the subsolar point comes from the
solar declination and equation of time, and the terminator is the great circle
where solar elevation is zero, so it is correct for the current date/time.

Rendering performance: `preferCanvas` plus `chunkedLoading` clustering, a
cluster radius that scales with zoom (z2 ≈ 63 → z11 ≈ 19 px), and an adaptive
boost if the measured frame time drops below ~38 fps. 11,000 aircraft stay
smooth; the HUD reports the live frame rate.

## Optional: OpenSky OAuth (free account, no payment)

Register at **https://opensky-network.org/** and paste the client ID/secret
into `OPENSKY_OAUTH` at the top of `js/config.js`:

```js
export const OPENSKY_OAUTH = {
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_SECRET',
};
```

What changes when you add them:
* Flight refresh drops from **5 min → 2 min** (authenticated cap ≈ 4,000
  requests/day instead of ~400).
* An OAuth token is fetched through the local proxy and reused until expiry.
* The source badge reads `OpenSky (OAuth)`.

If the credentials are ever invalid or the token endpoint is unreachable,
the app logs the failure and **falls back to anonymous access automatically** —
nothing else breaks. Empty strings = fully key-less, exactly the default.

---

## Known limits (things that are simulated or labelled)

* **Maritime** — real AIS vessel positions from Digitraffic (free, key-less,
  CC-BY), but the feed covers the **Baltic Sea only**. The map draws a dashed
  "AIS feed coverage" box, and chokepoints outside it are labelled as
  typical-traffic estimates instead of live counts.
* **Conflicts** — a curated zone baseline; GDELT's geo endpoint used to add
  live points but it is retired (404/429), so only verified data is drawn.
* **Satellites** — real SGP4 propagation from CelesTrak TLEs; if CelesTrak
  blocks the fetch, the last good TLE set is reused from local cache (valid for
  days) before the hardcoded fallback.
* **Flights** fall back to a labelled simulation only when OpenSky is
  unreachable. On a failed refresh the **last real positions stay on the map**
  and retries back off 45s → 90s → 180s → 300s (OpenSky's free tier answers
  429 when crowded).
* **CCTV** — currently London only (TfL), the only verified free key-less
  camera API. Add other cities by extending `js/feeds/cctv.js`.
* **AIS coverage is Baltic-only** (Digitraffic's open feed) — the map draws the
  coverage box. Vessel *operators/owners* are not part of the AIS feed, so the
  flag country decoded from the MMSI is shown instead of inventing company
  names. **Departure port** is not broadcast by AIS; destination is.

---

## Offline Istanbul map (free, no key)

The dashboard can render a **locally downloaded Istanbul map** instead of the
online basemaps — street-level detail at any zoom, clamped to the city, and it
works with **no internet connection for the tiles** (your OSINT feeds still
need internet).

### 1. Download the map (free)

From the project folder:

```bash
python3 download_istanbul_map.py                # recommended  (~2.4k tiles, ~90 MB)
python3 download_istanbul_map.py --preset quick # small & fast (~2.4k tiles, ~90 MB)
python3 download_istanbul_map.py --preset full  # every zoom (~39k tiles, ~1.5 GB)
```

**Do not use the official OpenStreetMap tile server for bulk downloads** — it
answers with a *"403 Access blocked / App is not following the tile usage
policy"* image for every tile and never recovers on its own. The default source
is therefore the German mirror `osm-de` (identical OpenStreetMap data,
tolerates polite bulk use). The downloader now watches for that failure mode:
if >90% of what it downloads is byte-identical and >1 KB, it **aborts** instead
of quietly filling the folder with placeholders.

Timing at the built-in politeness (3 workers, 0.2 s delay): `quick` ≈ 12 min,
`standard` ≈ 40 min, `full` ≈ 3 hours. Every download is resumable — press
Ctrl+C and rerun the same command to continue where it stopped. For very large
areas, get a Geofabrik extract and render it locally instead.

| Preset | Coverage | Tiles | Disk | Style |
|---|---|---|---|---|
| `quick` (default) | metro z0–13 + city core z14–15 | 2,366 | ~90 MB | street names, city centre |
| `standard` | metro z0–13 + city core z10–16 | 7,648 | ~290 MB | building-level core detail |
| `full` | whole metro z0–16 | 39,318 | ~1.5 GB | everything, offline |

Options: `--source osm-de|osm|topo|esri-sat` (all free, no API key; `osm-de` is the
default, the official OSM server 403-blocks bulk use), `--bbox
south,west,north,east`, `--zoom 8-14`, `--label <name>`, `--out <folder>`,
`--workers N` and `--delay s` if you need to throttle harder.

### 2. Where the tiles go

```
OSINT Center/
├── maps/
│   └── istanbul/              <- the download target (default)
│       ├── manifest.json       <- bbox + zoom range the app reads
│       └── {zoom}/{x}/{y}.png  <- the tile pyramid
├── serve.py                    <- serves /maps/* automatically
└── js/map/offlineMap.js        <- turns it into a basemap
```

Keep the map there — that is the folder the server reads. Any other label
(`maps/london`, `maps/newyork`) works too; the download script writes the
manifest the app needs.

### 3. Use it

Start the server, then either press **`B`** (cycles dark → voyager → **ISTANBUL
OFFLINE**) or click the **▤ basemap** control. When the offline map is active:
* the view is clamped to the downloaded bbox (you can't stray off the map),
* min/max zoom come from the manifest (no "no data" areas),
* it starts centred on Istanbul at a useful zoom,
* the **⬇** control prints what is installed to the event log.

The API key is never needed and no credits are consumed — the tiles come from
free public servers (Carto / OpenStreetMap / Esri). The download is resumable:
stop with Ctrl+C and rerun; existing tiles are skipped.

> **Tile-usage policy:** keep the built-in politeness (4 workers, 50 ms delay,
> a real User-Agent). Roughly 40k tiles for one metro area as a personal
> offline map is within acceptable use; don't use it to mirror whole
> countries. For much larger areas, download a Geofabrik extract and render
> your own tiles instead.

## Troubleshooting

* **"LOCAL PROXY OFFLINE" banner** → `serve.py` isn't running, or you're on a
  different port than `8000`. Restart it and reload.
* **Flights show `SRC: RETRYING`** → OpenSky rate-limited that request; the last
  real positions stay on the map while the app backs off automatically.
* **Flights show `SRC: SIMULATED`** → OpenSky stayed unreachable; the app keeps
  retrying in the background and swaps back to live data automatically.
* **Satellites show "cached TLEs"** → CelesTrak is temporarily blocking/500ing;
  positions stay accurate for days.
* **Everything loads but no news** → the RSS hosts may be blocked on your
  network; the panel then shows direct source links instead.
