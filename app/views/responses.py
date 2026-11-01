"""HTTP response helpers for JSON and static files."""

import gzip
import hashlib
import json
import os
import threading

STATIC_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

_file_cache = {}
_file_cache_lock = threading.Lock()


def send_response_data(handler, status, body, ctype="application/json", cache=None, extra_headers=None):
    if isinstance(body, (dict, list)):
        body = json.dumps(body, separators=(",", ":")).encode("utf-8")
        ctype = "application/json"
    elif isinstance(body, str):
        body = body.encode("utf-8")

    handler.send_response(status)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", cache or "no-store")
    handler.send_header("Referrer-Policy", "no-referrer")
    if extra_headers:
        for k, v in extra_headers.items():
            handler.send_header(k, v)
    handler.end_headers()
    handler.wfile.write(body)


def send_json(handler, status, data, cache=None):
    send_response_data(handler, status, data, ctype="application/json", cache=cache)


def send_redirect(handler, location):
    handler.send_response(303)
    handler.send_header("Location", location)
    handler.send_header("Content-Length", "0")
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()


def send_file(handler, full_path, cache_control="no-cache"):
    """Serve a file from disk/memory with ETag revalidation and gzip compression."""
    if not os.path.isfile(full_path):
        return send_json(handler, 404, {"error": "not found"})

    mtime = os.stat(full_path).st_mtime_ns
    with _file_cache_lock:
        ent = _file_cache.get(full_path)

    if not ent or ent["mtime"] != mtime:
        with open(full_path, "rb") as fh:
            raw = fh.read()
        ent = {
            "mtime": mtime,
            "raw": raw,
            "gz": gzip.compress(raw, 9),
            "etag": '"' + hashlib.sha1(raw).hexdigest()[:20] + '"',
        }
        with _file_cache_lock:
            _file_cache[full_path] = ent

    common = {
        "ETag": ent["etag"],
        "Cache-Control": cache_control,
        "Vary": "Accept-Encoding",
    }

    if handler.headers.get("If-None-Match") == ent["etag"]:
        handler.send_response(304)
        for k, v in common.items():
            handler.send_header(k, v)
        handler.end_headers()
        return

    use_gz = "gzip" in (handler.headers.get("Accept-Encoding") or "")
    body = ent["gz"] if use_gz else ent["raw"]
    ext = os.path.splitext(full_path)[1]
    ctype = STATIC_TYPES.get(ext, "application/octet-stream")

    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(body)))
    if use_gz:
        handler.send_header("Content-Encoding", "gzip")
    for k, v in common.items():
        handler.send_header(k, v)
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.end_headers()
    handler.wfile.write(body)
