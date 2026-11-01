import os
import re
import sys

# Project root directory
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ensure vendored yt-dlp is available in sys.path if present
VENDOR_YTDLP = os.path.join(ROOT, "vendor", "yt-dlp")
if os.path.exists(VENDOR_YTDLP) and VENDOR_YTDLP not in sys.path:
    sys.path.insert(0, VENDOR_YTDLP)

# Server & Network Configuration (Local defaults)
HOST = os.environ.get("YT_HOST", "127.0.0.1")
PORT = int(os.environ.get("YT_PORT", "8765"))
VIDEO_TTL = 5 * 3600     # googlevideo URLs expire after ~6h
SEARCH_TTL = 10 * 60
MAX_CACHE = 300
MAX_PARALLEL_EXTRACT = int(os.environ.get("YT_MAX_PARALLEL", "3"))  # each spawns node
YT_PROXY = os.environ.get("YT_PROXY") == "1"
PROXY_CHUNK = 8 * 1024 * 1024  # googlevideo throttles long open-ended reads; relay in slices
COPY_BUF = 256 * 1024

# Regex validation
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
SONY_REL_RE = re.compile(r"^[A-Za-z0-9_./-]+$")  # segment / init paths inside the stream folder

# Base options for yt-dlp
BASE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "noplaylist": True,
    "js_runtimes": {"node": {}},
    "mark_watched": False,
    "extractor_args": {
        "youtube": {
            "player_client": ["visionos", "android", "tvhtml5"],
            "skip": ["hls", "dash"],
        }
    },
}

YT_SOURCE = os.environ.get("YT_SOURCE_ADDRESS", "")
if YT_SOURCE:
    BASE_OPTS["source_address"] = YT_SOURCE

YT_PROXY_URL = os.environ.get("YT_PROXY_URL", "")
if YT_PROXY_URL:
    BASE_OPTS["proxy"] = YT_PROXY_URL

YT_COOKIES = os.environ.get("YT_COOKIES", "")
if not YT_COOKIES:
    for candidate in [
        os.path.join(ROOT, "www.youtube.com_cookies.txt"),
        os.path.expanduser("~/.config/localtube/cookies.txt"),
    ]:
        if os.path.isfile(candidate):
            YT_COOKIES = candidate
            break

if YT_COOKIES and os.path.isfile(YT_COOKIES):
    BASE_OPTS["cookiefile"] = YT_COOKIES

# Static files directory
STATIC_DIR = os.path.join(ROOT, "static")
if not os.path.isdir(STATIC_DIR):
    for candidate in [
        os.path.join(os.path.dirname(__file__), "..", "static"),
        os.path.join(os.path.dirname(__file__), "static"),
    ]:
        if os.path.isdir(candidate):
            STATIC_DIR = os.path.abspath(candidate)
            break
