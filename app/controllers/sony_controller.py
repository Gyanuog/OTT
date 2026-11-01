"""Sony LIV controller: search, home, shows, seasons, video metadata and manifest relay."""

import urllib.error
import urllib.request
from urllib.parse import urlsplit
from app.config import SONY_REL_RE, COPY_BUF
from app.controllers.base import BaseController
from app.models import sony
from app.services.cache import sony_cache
from app.views.responses import send_json


class SonyController(BaseController):
    @classmethod
    def handle(cls, handler, route, query_params):
        arg = lambda k: cls.get_query_param(query_params, k)

        if route == "home":
            return send_json(handler, 200, sony_cache.get("home", lambda: sony.home()), cache="private, max-age=300")

        if route == "search":
            query = arg("q")[:200]
            if not query:
                return send_json(handler, 400, {"error": "empty query"})
            results = sony_cache.get(("s", query.lower()), lambda: sony.search(query))
            return send_json(handler, 200, results)

        vid = arg("id")
        if not vid or not vid.isdigit():
            return send_json(handler, 400, {"error": "bad id"})

        if route == "show":
            return send_json(handler, 200, sony_cache.get(("show", vid), lambda: sony.show(vid)), cache="private, max-age=300")

        if route == "season":
            episodes = sony_cache.get(("season", vid), lambda: sony.season(vid))
            return send_json(handler, 200, {"episodes": episodes}, cache="private, max-age=300")

        if route == "video":
            info = sony_cache.get(("video", vid), lambda: sony.video(vid))
            resp = dict(info)
            resp.pop("mpd", None)  # signed upstream URL stays server-side; browser uses relay
            resp["manifest"] = None if info.get("drm") else f"/api/sony/manifest/{vid}/manifest.mpd"
            return send_json(handler, 200, resp)

        return send_json(handler, 404, {"error": "not found"})

    @classmethod
    def manifest(cls, handler, path, query_string):
        parts = path.strip("/").split("/", 1)
        if len(parts) < 2:
            return send_json(handler, 400, {"error": "bad path"})

        vid, rel_path = parts[0], parts[1]
        if not sony.ID_RE.match(vid) or ".." in rel_path or not SONY_REL_RE.match(rel_path):
            return send_json(handler, 400, {"error": "bad path"})

        vinfo = sony_cache.get(("video", vid), lambda: sony.video(vid))
        mpd_url = vinfo.get("mpd")
        if not mpd_url:
            return send_json(handler, 404, {"error": "stream not found"})

        split = urlsplit(mpd_url)
        base_path = split.path.rsplit("/", 1)[0] + "/"
        base_url = f"{split.scheme}://{split.netloc}{base_path}"

        if rel_path == "manifest.mpd":
            target_url = mpd_url
        else:
            target_url = base_url + rel_path
            if query_string:
                target_url += ("&" if "?" in target_url else "?") + query_string

        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": "https://www.sonyliv.com",
            "Referer": "https://www.sonyliv.com/",
            "x-playback-session-id": f"slv-{vid}",
            "Accept": "*/*",
        }
        if handler.headers.get("Range"):
            headers["Range"] = handler.headers.get("Range")

        try:
            req = urllib.request.Request(target_url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as r:
                handler.send_response(r.status)
                for h in ("Content-Type", "Content-Length", "Content-Range", "Last-Modified"):
                    if r.headers.get(h):
                        handler.send_header(h, r.headers.get(h))
                handler.send_header("Access-Control-Allow-Origin", "*")
                handler.send_header("Accept-Ranges", "bytes")
                handler.send_header("Cache-Control", "private, max-age=3600")
                handler.end_headers()
                while chunk := r.read(COPY_BUF):
                    handler.wfile.write(chunk)
        except urllib.error.HTTPError as e:
            return send_json(handler, e.code, {"error": f"upstream error: {e}"})
        except Exception as e:
            return send_json(handler, 502, {"error": f"upstream relay failed: {e}"})
