"""MX Player controller: search, home, shows, seasons, and playback."""

import re
from app.controllers.base import BaseController
from app.models import mx
from app.services.cache import mx_cache
from app.views.responses import send_json


class MXController(BaseController):
    @classmethod
    def handle(cls, handler, route, query_params):
        arg = lambda k: cls.get_query_param(query_params, k)

        if route == "search":
            query = arg("q")[:200]
            if not query:
                return send_json(handler, 400, {"error": "empty query"})
            direct = mx.parse_url(query)
            if direct:
                return send_json(handler, 200, {"direct": {"type": direct[0], "id": direct[1]}})
            results = mx_cache.get(("s", query.lower()), lambda: mx.search(query))
            return send_json(handler, 200, {"results": results})

        if route == "home":
            cursor = arg("next")[:120]
            if cursor and not re.fullmatch(r"next=[0-9a-f]{32}", cursor):
                return send_json(handler, 400, {"error": "bad cursor"})
            data = mx_cache.get(("home", cursor), lambda: mx.home(cursor))
            return send_json(handler, 200, data, cache="private, max-age=300")

        vid, kind = arg("id"), arg("type")
        if not mx.ID_RE.match(vid):
            return send_json(handler, 400, {"error": "bad id"})

        if route == "show":
            data = mx_cache.get(("show", vid), lambda: mx.show(vid))
            return send_json(handler, 200, data, cache="private, max-age=300")

        if route == "season":
            episodes = mx_cache.get(("season", vid), lambda: mx.season(vid))
            return send_json(handler, 200, {"episodes": episodes}, cache="private, max-age=300")

        if route == "video" and kind in ("movie", "episode", "shorts"):
            data = mx_cache.get(("video", vid), lambda: mx.video(kind, vid))
            return send_json(handler, 200, data)

        return send_json(handler, 404, {"error": "not found"})
