#!/usr/bin/env python3
"""Personal ad-free YouTube + MX Player backend (Local mode).

Stdlib-only HTTP server organized in MVC (Model-View-Controller) architecture.
"""
import threading
from http.server import ThreadingHTTPServer

from app.config import HOST, PORT, YT_PROXY
from app.models.youtube import (
    extract_video,
    search,
    parse_video_id,
    public_info,
    enqueue_prefetch,
    warm_up,
)
from app.router import AppRequestHandler
from app.services import jsc_fast
from app.services.cache import video_cache, search_cache, mx_cache, sony_cache
import yt_dlp

# Handler alias
Handler = AppRequestHandler

# Install long-lived node worker for YouTube's JS challenges
jsc_fast.install()


def main():
    threading.Thread(target=warm_up, daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), AppRequestHandler)
    httpd.daemon_threads = True
    mode = "yt-proxy" if YT_PROXY else "local"
    print(f"yt-dlp {yt_dlp.version.__version__} | {mode} | http://{HOST}:{PORT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
