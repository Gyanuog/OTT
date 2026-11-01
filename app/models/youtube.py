"""YouTube data model and extraction service using yt-dlp."""

import collections
import contextlib
import http.client
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

# Ensure yt-dlp is in sys.path
from app.config import (
    BASE_OPTS,
    ID_RE,
    MAX_PARALLEL_EXTRACT,
    VIDEO_TTL,
    YT_PROXY,
    VENDOR_YTDLP,  # noqa: F401
)
import yt_dlp
from app.services.cache import video_cache
from app.services.network import upstream_get

extract_slots = threading.BoundedSemaphore(MAX_PARALLEL_EXTRACT)

# Creating a YoutubeDL costs ~0.3-0.6s; keep warm instances per mode and reuse them.
_ydl_free = collections.defaultdict(list)
_ydl_lock = threading.Lock()


def _codec_family(vcodec):
    v = (vcodec or "").lower()
    if v.startswith("avc1"):
        return "h264"
    if v.startswith(("vp9", "vp09")):
        return "vp9"
    if v.startswith("av01"):
        return "av1"
    return v.split(".")[0] or "unknown"


def _stream_ok(info):
    """True if a googlevideo URL from this extraction actually serves bytes."""
    f = next((f for f in info.get("formats") or []
              if f.get("protocol") == "https" and f.get("url") and f.get("vcodec") not in (None, "none")), None)
    if not f:
        return False
    try:
        conn, up = upstream_get(f["url"], {**(f.get("http_headers") or {}), "Range": "bytes=0-1023"})
        up.read()
        return up.status in (200, 206)
    except (http.client.HTTPException, OSError):
        return False


@contextlib.contextmanager
def _ydl(mode, opts):
    with _ydl_lock:
        ydl = _ydl_free[mode].pop() if _ydl_free[mode] else None
    if ydl is None:
        ydl = yt_dlp.YoutubeDL(opts)
    try:
        yield ydl
    finally:
        if mode == "cookies":
            try:
                ydl.cookiejar.save()  # keep YouTube's rotated session cookies
            except Exception:
                pass
        with _ydl_lock:
            _ydl_free[mode].append(ydl)


def _extract_attempts():
    modes = {"anon": {k: v for k, v in BASE_OPTS.items() if k != "cookiefile"}}
    if "cookiefile" in BASE_OPTS:
        modes["cookies"] = BASE_OPTS
    order = sorted(modes, key=lambda m: m != "anon")  # cookies only when anonymous fails
    return [(m, modes[m]) for m in order]


def extract_video(vid):
    """Try extraction modes in order (anonymous first, cookies as fallback) and take the
    first one whose stream URL is verified to actually serve bytes."""
    info, last_err = None, None
    with extract_slots:
        for mode, opts in _extract_attempts():
            try:
                with _ydl(mode, opts) as ydl:
                    candidate = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
            except yt_dlp.utils.DownloadError as e:
                last_err = e
                continue
            if candidate.get("is_live") or _stream_ok(candidate):
                info = candidate
                break
            info = info or candidate
    if info is None:
        raise last_err

    live = info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming")
    videos, audios = [], []
    for f in info.get("formats") or []:
        if f.get("protocol") != "https" or not f.get("url"):
            continue
        fid = str(f.get("format_id", ""))
        if "drc" in fid:
            continue
        has_v = f.get("vcodec") not in (None, "none")
        has_a = f.get("acodec") not in (None, "none")
        if has_v and not has_a:
            videos.append({
                "id": fid,
                "url": f["url"],
                "height": f.get("height") or 0,
                "fps": f.get("fps") or 0,
                "headers": f.get("http_headers") or {},
                "codec": _codec_family(f.get("vcodec")),
                "codecs": f.get("vcodec"),
                "mime": f"video/{f.get('ext')}",
                "tbr": round(f.get("tbr") or 0),
            })
        elif has_a and not has_v:
            audios.append({
                "id": fid,
                "url": f["url"],
                "headers": f.get("http_headers") or {},
                "codec": (f.get("acodec") or "").split(".")[0],
                "codecs": f.get("acodec"),
                "mime": f"audio/{'mp4' if f.get('ext') == 'm4a' else f.get('ext')}",
                "abr": round(f.get("abr") or f.get("tbr") or 0),
                "lang": f.get("language"),
                "default": (f.get("format_note") or "").lower().find("original") >= 0,
            })
    videos.sort(key=lambda f: (f["height"], f["fps"], f["tbr"]), reverse=True)
    audios.sort(key=lambda f: (f["default"], f["abr"]), reverse=True)

    return {
        "id": vid,
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "channel_id": info.get("channel_id"),
        "duration": info.get("duration"),
        "views": info.get("view_count"),
        "upload_date": info.get("upload_date"),
        "description": (info.get("description") or "")[:5000],
        "chapters": [
            {"start": c.get("start_time"), "title": c.get("title")}
            for c in info.get("chapters") or []
        ],
        "live": bool(live),
        "videos": videos,
        "audios": audios,
        "expires": int(time.time()) + VIDEO_TTL,
    }


def public_info(info):
    """Format video info for client consumption, rewriting URLs to relay if proxying."""
    def fmt(f):
        out = {k: v for k, v in f.items() if k != "headers"}
        if YT_PROXY:
            out["url"] = f"/api/yt/stream/{info['id']}/{f['id']}"
        return out
    return {**info, "videos": [fmt(f) for f in info["videos"]], "audios": [fmt(f) for f in info["audios"]]}


# Background prefetch queue
_prefetch_q = collections.deque()
_prefetch_cv = threading.Condition()
PREFETCH_MAX_QUEUE = 40


def enqueue_prefetch(vid, urgent=False):
    if video_cache.has(vid):
        return
    with _prefetch_cv:
        if vid in _prefetch_q:
            _prefetch_q.remove(vid)
        (_prefetch_q.appendleft if urgent else _prefetch_q.append)(vid)
        while len(_prefetch_q) > PREFETCH_MAX_QUEUE:
            _prefetch_q.pop()
        _prefetch_cv.notify()


def _prefetch_loop():
    while True:
        with _prefetch_cv:
            while not _prefetch_q:
                _prefetch_cv.wait()
            vid = _prefetch_q.popleft()
        try:
            video_cache.get(vid, lambda: extract_video(vid))
        except Exception:
            pass


threading.Thread(target=_prefetch_loop, daemon=True).start()


def search(query, count=24):
    opts = {k: v for k, v in BASE_OPTS.items() if k != "cookiefile"}
    opts["extract_flat"] = "in_playlist"
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch{count}:{query}", download=False)
    except yt_dlp.utils.DownloadError as e:
        if "not a bot" not in str(e) or "cookiefile" not in BASE_OPTS:
            raise
        with yt_dlp.YoutubeDL(dict(BASE_OPTS, extract_flat="in_playlist")) as ydl:
            info = ydl.extract_info(f"ytsearch{count}:{query}", download=False)
    out = []
    for e in info.get("entries") or []:
        vid = e.get("id")
        if not vid or not ID_RE.match(vid):
            continue
        out.append({
            "id": vid,
            "title": e.get("title"),
            "channel": e.get("channel") or e.get("uploader"),
            "duration": e.get("duration"),
            "views": e.get("view_count"),
            "live": e.get("live_status") == "is_live",
        })
    return out


def parse_video_id(text):
    text = (text or "").strip()
    if ID_RE.match(text):
        return text
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([A-Za-z0-9_-]{11})", text)
    return m.group(1) if m else None


def home():
    """Live categorized YouTube India home feed with hero banner items."""
    tray_configs = [
        ("🔥 Trending in India", "trending videos india", 12),
        ("🎵 Trending Music & Hits", "new hindi songs trending", 10),
        ("🎬 Latest Movie Trailers", "latest movie trailers hindi", 10),
        ("😂 Comedy & Entertainment", "trending comedy videos india", 10),
        ("🏏 Cricket & Sports Highlights", "cricket highlights india match", 10),
        ("📱 Tech & Gadgets", "latest tech unboxing hindi", 10),
        ("🎮 Trending Gaming", "trending gaming videos india", 10),
        ("📰 Top News & Affairs", "top news headlines india today", 10),
    ]

    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(lambda c: {"title": c[0], "items": search(c[1], count=c[2])}, tray_configs))

    hero_items = []
    if rows and rows[0]["items"]:
        for it in rows[0]["items"][:5]:
            hero_items.append({
                "id": it["id"],
                "title": it["title"],
                "channel": it.get("channel") or "",
                "views": it.get("views"),
                "banner": f"https://i.ytimg.com/vi/{it['id']}/maxresdefault.jpg",
                "img": f"https://i.ytimg.com/vi/{it['id']}/hqdefault.jpg",
                "desc": f"{it.get('channel') or ''}" + (f" • {it.get('views')} views" if it.get("views") else ""),
            })

    return {
        "hero": hero_items,
        "rows": [r for r in rows if r["items"]],
    }


def warm_up():
    """Start the JS-challenge worker and pre-warm YouTubeDL pools & India home feed."""
    try:
        video_cache.get("jNQXAC9IVRw", lambda: extract_video("jNQXAC9IVRw"))
    except Exception:
        pass
    try:
        from app.services.cache import search_cache
        search_cache.get("yt_home_in", lambda: home())
    except Exception:
        pass
