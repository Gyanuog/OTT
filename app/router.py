"""HTTP request router and handler for local streaming platform."""

import os
import re
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from app.controllers import (
    YouTubeController,
    MXController,
    SonyController,
    ViewController,
)
from app.models.mx import MxError
from app.models.sony import SonyError
from app.views.responses import send_json
import yt_dlp


class AppRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "yt-local"

    def log_message(self, fmt, *args):
        if os.environ.get("YT_DEBUG"):
            super().log_message(fmt, *args)

    def do_POST(self):
        return send_json(self, 404, {"error": "not found"})

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)

        try:
            # YouTube Stream Relay
            if url.path.startswith("/api/yt/stream/"):
                parts = url.path[len("/api/yt/stream/"):].split("/", 1)
                vid = parts[0]
                fid = parts[1] if len(parts) > 1 else ""
                return YouTubeController.stream(self, vid, fid)

            # Web Views
            if url.path in ("/", "/index.html"):
                return ViewController.index(self)

            if url.path.startswith("/static/"):
                return ViewController.static(self, url.path)

            # Status API (login is disabled in local mode)
            if url.path == "/api/me":
                return send_json(self, 200, {"login": False})

            # MX Player APIs
            if url.path.startswith("/api/mx/"):
                return MXController.handle(self, url.path[8:], q)

            # Sony LIV APIs
            if url.path.startswith("/api/sony/manifest/"):
                return SonyController.manifest(self, url.path[len("/api/sony/manifest/"):], url.query)

            if url.path.startswith("/api/sony/"):
                return SonyController.handle(self, url.path[10:], q)

            # YouTube APIs
            if url.path == "/api/yt/home":
                return YouTubeController.home(self)

            if url.path == "/api/search":
                return YouTubeController.search(self, q)

            if url.path == "/api/video":
                return YouTubeController.video(self, q)

            if url.path == "/api/prefetch":
                return YouTubeController.prefetch(self, q)

            return send_json(self, 404, {"error": "not found"})

        except (MxError, SonyError) as e:
            return send_json(self, 404, {"error": str(e)})
        except yt_dlp.utils.DownloadError as e:
            msg = re.sub(r"\x1b\[[0-9;]*m", "", str(e)).replace("ERROR: ", "")
            if "not a bot" in msg:
                msg = ("YouTube ne is IP ko bot samajh kar block kiya hai. "
                       "cookies.txt set karo ya update karo (YT_COOKIES).")
            return send_json(self, 502, {"error": msg})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            return send_json(self, 500, {"error": f"{type(e).__name__}: {e}"})
