#!/usr/bin/env python3
"""
VOID//MATRIX local server — static files + a local CORS proxy.

Everything is Python 3 standard library. No installs, no accounts, no keys.

    python3 serve.py [--port 8000]

Why this exists
---------------
Every public CORS proxy the app used to rely on (allorigins, codetabs,
corsproxy.io, thingproxy, cors.sh) is dead or rate-limited, and browsers
block direct calls to the free OSINT APIs used here (OpenSky, Feodo,
USGS, EONET, CelesTrak, TfL JamCams, RSS feeds). This server both hosts
the page and backs its /proxy endpoint, so:

    fetch('/proxy?url=' + encodeURIComponent(target))

works from the browser with no external dependency and no third party
seeing the traffic.

Routes
------
    /proxy?url=<url-encoded target>   -> proxied GET of any http(s) URL
    everything else                   -> static file from this directory
"""

import argparse
import gzip
import json
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urljoin, urlparse, parse_qs

PROXY_TIMEOUT = 30          # seconds
MAX_BYTES = 32 * 1024 * 1024
USER_AGENT = "Mozilla/5.0 (compatible; VOID-MATRIX-OSINT/3.0; +local-console)"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


class Handler(SimpleHTTPRequestHandler):
    server_version = "VoidMatrix/3.0"
    protocol_version = "HTTP/1.1"
    root = os.path.dirname(os.path.abspath(__file__))

    # ---------- helpers ----------
    """Every response the /proxy route produces carries X-Proxy so the browser
    can tell 'the local proxy answered' (even with a 404/502 from the target)
    from 'the proxy is unreachable'."""
    PROXY_HEADER = {"X-Proxy": "voidmatrix-serve/1.0"}

    def _send(self, status, body=b"", ctype="text/plain; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
    def _json(self, status, payload):
        # tagged like every other /proxy response so the browser can tell
        # "the proxy answered (upstream failed)" from "proxy unreachable"
        self._send(status, json.dumps(payload), "application/json", self.PROXY_HEADER)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    # ---------- proxy ----------
    # Request headers may be forwarded via ?headers=<json> so authenticated
    # APIs (e.g. OpenSky's Bearer token) work through the GET route too.
    HOP_BY_HOP = ("host", "content-length", "connection", "keep-alive",
                  "transfer-encoding", "upgrade", "expect")

    def _proxy(self):
        # POST form (JSON body describing the request) lets the browser do
        # authenticated calls such as OpenSky's OAuth2 token endpoint.
        if self.command == "POST":
            return self._proxy_post()

        qs = parse_qs(urlparse(self.path).query)
        target = (qs.get("url") or [""])[0]
        try:
            extra = json.loads((qs.get("headers") or ["{}"])[0])
        except Exception:
            extra = {}
        extra = {k: str(v) for k, v in extra.items()
                 if k.lower() not in self.HOP_BY_HOP}
        self._fetch_and_send(target, "GET", extra, None)

    def _proxy_post(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"error": "invalid JSON body"})

        target = payload.get("url") or ""
        parsed = urlparse(target)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return self._json(400, {"error": "pass {url: 'http(s) url'}"})

        headers = {k: str(v) for k, v in (payload.get("headers") or {}).items()}
        headers.setdefault("User-Agent", USER_AGENT)
        self._fetch_and_send(target, payload.get("method") or "POST", headers,
                             payload.get("body"))

    def _fetch_and_send(self, target, method, extra_headers, body, _allow_gzip_retry=True):
        if urlparse(target).scheme not in ("http", "https"):
            return self._json(400, {"error": "only http(s) targets"})

        data = None
        if body is not None:
            data = body.encode("utf-8") if isinstance(body, str) else body

        headers = {**extra_headers, "User-Agent": USER_AGENT, "Accept": "*/*"}
        headers.setdefault("Accept-Encoding", "identity")

        req = urllib.request.Request(target, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=PROXY_TIMEOUT) as r:
                blob = self._maybe_gunzip(r.read(MAX_BYTES + 1), r.headers.get("Content-Encoding"))
                if len(blob) > MAX_BYTES:
                    return self._json(502, {"error": "response too large"})
                ctype = r.headers.get("Content-Type") or "application/octet-stream"
                extra = {**self.PROXY_HEADER, "X-Proxied-Url": target}
                # HLS/DASH live playlists carry *relative* segment URLs — a
                # browser cannot resolve them against a proxied URL. Rewrite
                # every URI in the playlist to an absolute URL through this
                # same /proxy route so <video>/hls.js playback just works,
                # even when the camera host sends no CORS headers.
                if self._is_playlist(blob, ctype):
                    base = r.geturl() or target
                    try:
                        text = self._rewrite_playlist(
                            blob.decode("utf-8", "replace"), base)
                        blob = text.encode("utf-8")
                        ctype = "application/vnd.apple.mpegurl"
                        # live playlists must never be cached — end_headers()
                        # already forces no-store for every /proxy response
                    except Exception:                                  # noqa: BLE001
                        pass                                            # send the raw playlist
                self._send(r.status, blob, ctype, extra)
        except urllib.error.HTTPError as e:
            err = e.read() or b""
            # Some APIs (e.g. Digitraffic AIS) *require* gzip — retry once with it.
            if _allow_gzip_retry and b"gzip" in err[:300].lower():
                return self._fetch_and_send(
                    target, method, {**extra_headers, "Accept-Encoding": "gzip"}, body, False)
            self._send(e.code, err,
                       e.headers.get("Content-Type") or "text/plain",
                       self.PROXY_HEADER)
        except Exception as e:                                    # noqa: BLE001
            self._json(502, {"error": "proxy fetch failed", "detail": str(e)[:200]})

    @staticmethod
    def _maybe_gunzip(blob, content_encoding):
        """Decompress when the target honoured our gzip request."""
        if blob[:2] == b"\x1f\x8b" or (content_encoding or "").lower() == "gzip":
            try:
                return gzip.decompress(blob)
            except Exception:                                     # noqa: BLE001
                return blob
        return blob

    # ---------- HLS playlist rewrite (live CCTV playback) ----------
    PLAYLIST_ROUTE = "/proxy?url="
    _URI_ATTR = re.compile(r'URI="([^"]*)"')

    @classmethod
    def _is_playlist(cls, blob, ctype):
        if "mpegurl" in (ctype or "").lower() or "x-mpegurl" in (ctype or "").lower():
            return True
        return blob[:64].lstrip()[:7] == b"#EXTM3U"

    @classmethod
    def _rewrite_playlist(cls, text, base):
        """Make every URI in an HLS playlist absolute and routed via /proxy.

        `base` is the *final* upstream URL (after redirects), so both
        relative (``chunklist_w123.m3u8``) and already-absolute URIs become
        ``/proxy?url=<absolute>``. Encrypted streams keep working because
        #EXT-X-KEY / #EXT-X-MAP URI attributes are rewritten too.
        """
        def wrap(uri):
            uri = uri.strip()
            if not uri or uri.startswith("#") or uri.startswith("data:"):
                return uri
            absolute = urljoin(base, uri)
            return cls.PLAYLIST_ROUTE + quote(absolute, safe="")

        out = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                if "URI=" in line:
                    line = cls._URI_ATTR.sub(
                        lambda m: 'URI="%s"' % wrap(m.group(1)), line)
                out.append(line)
            else:
                out.append(wrap(stripped))
        return "\n".join(out)

    # ---------- static ----------
    def _serve_file(self, rel):
        full = os.path.normpath(os.path.join(self.root, rel.lstrip("/")))
        if not full.startswith(self.root):                        # no traversal
            return self._json(403, {"error": "forbidden"})
        if rel.lstrip("/").startswith(("maps/", "tiles/")) and not os.path.exists(full):
            ext = os.path.splitext(full)[1].lower()
            if ext in (".png", ".jpg", ".jpeg", ".webp"):
                # offline map pyramid: a missing tile is a normal "no data
                # yet" answer, never a server error page.
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            return self._json(404, {"error": "not found"})
        self._send(200, body, MIME.get(os.path.splitext(full)[1].lower(),
                                       "application/octet-stream"))

    # ---------- routing ----------
    def _route(self):
        path = urlparse(self.path).path
        if path == "/proxy":
            return self._proxy()
        if path == "/health":                     # liveness probe
            return self._json(200, {"ok": True, "server": "voidmatrix"})
        if path in ("/", "/index.html"):
            return self._serve_file("index.html")
        return self._serve_file(path)

    def do_GET(self):
        self._route()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/proxy":
            return self._json(404, {"error": "not found"})
        self._route()

    def do_HEAD(self):
        self._route()

    def end_headers(self):
        if self.path.startswith(("/maps/", "/tiles/")):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description="VOID//MATRIX local server + CORS proxy")
    ap.add_argument("--port", "-p", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print("┌────────────────────────────────────────────────────────────┐")
    print("│  VOID//MATRIX — OSINT COMMAND CENTER                       │")
    print("├────────────────────────────────────────────────────────────┤")
    print(f"│  OPEN      {url:<46}│")
    print("│  PROXY     /proxy?url=<encoded target>                     │")
    print("│  SOURCES   OpenSky · USGS · EONET · Feodo · CelesTrak      │")
    print("│            TfL JamCams · BBC·AJ·Guardian·DW·NPR RSS        │")
    print("│  COST      free — no API keys required                     │")
    print("└────────────────────────────────────────────────────────────┘")
    print("  Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
