"""View controller: serves index HTML and static assets."""

import os
from app.config import STATIC_DIR
from app.controllers.base import BaseController
from app.views.responses import send_file, send_json, STATIC_TYPES


class ViewController(BaseController):
    @classmethod
    def index(cls, handler):
        index_file = os.path.join(STATIC_DIR, "index.html")
        return send_file(handler, index_file, cache_control="no-cache")

    @classmethod
    def static(cls, handler, path):
        sub_path = path[len("/static/"):].lstrip("/")
        full = os.path.realpath(os.path.join(STATIC_DIR, sub_path))
        ext = os.path.splitext(full)[1]
        if not full.startswith(STATIC_DIR + os.sep) or ext not in STATIC_TYPES or not os.path.isfile(full):
            return send_json(handler, 404, {"error": "not found"})
        return send_file(handler, full, cache_control="public, max-age=604800, immutable")
