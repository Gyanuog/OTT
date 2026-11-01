"""YouTube controller: search, video details, stream relay, prefetching."""

import http.client
import re
from app.config import ID_RE, YT_PROXY, PROXY_CHUNK, COPY_BUF
from app.controllers.base import BaseController
from app.models.youtube import (
    extract_video,
    search as yt_search,
    home as yt_home,
    parse_video_id,
    public_info,
    enqueue_prefetch,
)
from app.services.cache import video_cache, search_cache
from app.services.network import upstream_get, drop_upstream
from app.views.responses import send_json


class YouTubeController(BaseController):
    @classmethod
    def home(cls, handler):
        data = search_cache.get("yt_home_in", lambda: yt_home())
        return send_json(handler, 200, data, cache="private, max-age=300")

    @classmethod
    def search(cls, handler, query_params):
        query = cls.get_query_param(query_params, "q")[:200]
        if not query:
            return send_json(handler, 400, {"error": "empty query"})
        vid = parse_video_id(query)
        if vid and (len(query) == 11 or "youtu" in query):
            return send_json(handler, 200, {"direct": vid})
        results = search_cache.get(query.lower(), lambda: yt_search(query))
        return send_json(handler, 200, {"results": results}, cache="private, max-age=300")

    @classmethod
    def video(cls, handler, query_params):
        vid = parse_video_id(cls.get_query_param(query_params, "id"))
        if not vid:
            return send_json(handler, 400, {"error": "bad id"})
        if cls.get_query_param(query_params, "fresh") == "1":
            video_cache.drop(vid)
        info = video_cache.get(vid, lambda: extract_video(vid))
        return send_json(handler, 200, public_info(info))

    @classmethod
    def prefetch(cls, handler, query_params):
        vid = parse_video_id(cls.get_query_param(query_params, "id"))
        if not vid:
            return send_json(handler, 400, {"error": "bad id"})
        is_urgent = cls.get_query_param(query_params, "now") == "1"
        enqueue_prefetch(vid, urgent=is_urgent)
        handler.send_response(204)
        handler.send_header("Content-Length", "0")
        handler.end_headers()

    @classmethod
    def stream(cls, handler, vid, fid=""):
        """Relay one googlevideo stream, honouring the browser's Range but
        capping each upstream request so YouTube doesn't throttle it."""
        if not YT_PROXY or not ID_RE.match(vid):
            return send_json(handler, 404, {"error": "not found"})

        info = video_cache.get(vid, lambda: extract_video(vid))
        f = next((x for x in info["videos"] + info["audios"] if x["id"] == fid), None)
        if not f:
            return send_json(handler, 404, {"error": "format not found"})

        start, end = 0, None
        m = re.match(r"bytes=(\d+)-(\d*)", handler.headers.get("Range") or "")
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else None
        end = min(end if end is not None else start + PROXY_CHUNK - 1, start + PROXY_CHUNK - 1)
        headers = {**f["headers"], "Range": f"bytes={start}-{end}"}

        try:
            conn, up = upstream_get(f["url"], headers)
            if up.status in (301, 302, 303, 307, 308) and up.getheader("Location"):
                up.read()
                conn, up = upstream_get(up.getheader("Location"), headers)
        except (http.client.HTTPException, OSError) as e:
            return send_json(handler, 502, {"error": f"upstream: {e}"})

        if up.status >= 400:
            up.read()
            if up.status in (403, 410):
                video_cache.drop(vid)
            return send_json(handler, 416 if up.status == 416 else 502, {"error": f"upstream {up.status}"})

        try:
            handler.send_response(up.status)
            for h in ("Content-Type", "Content-Length", "Content-Range", "Last-Modified"):
                if up.getheader(h):
                    handler.send_header(h, up.getheader(h))
            handler.send_header("Accept-Ranges", "bytes")
            handler.send_header("Cache-Control", "private, max-age=3600")
            if not up.getheader("Content-Length"):
                handler.send_header("Connection", "close")
                handler.close_connection = True
            handler.end_headers()
            while chunk := up.read(COPY_BUF):
                handler.wfile.write(chunk)
        except BaseException:
            drop_upstream(conn)
            raise
