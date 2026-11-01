"""MX Player model: talks to MX's public JSON API directly.

Episode lists already carry each episode's HLS path, so a whole season is
resolved with a handful of small JSON requests. Ads are requested by MX's own
player via `adTagProvider`; we simply never ask for them. DRM-protected or
locked titles have no open stream and are reported as unsupported.
"""
import gzip
import json
import re
import urllib.parse
import urllib.request

API = "https://api.mxplayer.in/v1/web/"
CDN = "https://d3sgzbosmwirao.cloudfront.net/"
IMG = "https://qqcdnpictest.mxplay.com/"
COMMON = {"platform": "com.mxplay.desktop", "content-languages": "hi,en"}
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json", "Accept-Encoding": "gzip"}
MAX_SEASON_PAGES = 30

ID_RE = re.compile(r"^[0-9a-f]{32}$")
TYPES = {"movie", "episode", "shorts", "tvshow", "season"}


class MxError(Exception):
    pass


def _get(path, **params):
    url = API + path
    url += ("&" if "?" in url else "?") + urllib.parse.urlencode({**COMMON, **params})
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=15) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return json.loads(raw)


def _img(item, prefer=("landscape", "bigpic")):
    info = {i.get("type"): i.get("url")
            for key in ("imageInfo", "titleContentImageInfo")
            for i in item.get(key) or [] if i.get("url")}
    for kind in prefer:
        if info.get(kind):
            return IMG + info[kind].lstrip("/")
    return None


def _hls(item):
    s = item.get("stream") or {}
    if s.get("drmProtect"):
        return None
    for src in (s, s.get("mxplay") or {}):
        hls = src.get("hls") or {}
        for key in ("high", "main", "base"):
            path = hls.get(key)
            if path:
                return path if path.startswith("http") else CDN + path.lstrip("/")
    for u in (s.get("thirdParty") or {}).values():
        if isinstance(u, str) and ".m3u8" in u:
            return u
    return None


def _card(it):
    t = it.get("type")
    container = it.get("container") or {}
    show = (container.get("container") or {}).get("title") or container.get("title")
    return {
        "type": t,
        "id": it.get("id"),
        "title": it.get("title"),
        "img": _img(it),
        "poster": _img(it, ("portrait_large", "portrait")),
        "duration": it.get("duration"),
        "seq": it.get("sequence"),
        "date": (it.get("publishTime") or it.get("releaseDate") or "")[:10],
        "show": show if t == "episode" else None,
        "desc": (it.get("description") or "")[:240],
        "playable": bool(_hls(it)) if t in ("movie", "episode", "shorts") else None,
    }


HOME_TAB = "87c3ddc974dcf12294e9412bec44b097"


def home(cursor=""):
    """One page of MX's home feed: curated rows plus the cursor for the next page.
    The first row's items also carry banner/logo art for the hero carousel."""
    j = _get(f"home/tab/{HOME_TAB}", **dict(urllib.parse.parse_qsl(cursor)))
    rows = []
    for i, sec in enumerate(j.get("sections") or []):
        items = [it for it in sec.get("items") or []
                 if it.get("type") in TYPES and ID_RE.match(it.get("id") or "")]
        if not items:
            continue
        cards = [_card(it) for it in items]
        if not cursor and i == 0:
            for c, it in zip(cards, items):
                c["banner"] = _img(it, ("banner_and_static_bg_desktop", "bigpic"))
                c["logo"] = _img(it, ("title_desktop",))
        rows.append({"title": sec.get("name") or "", "items": cards})
    return {"rows": rows, "next": j.get("next") or ""}


def search(query):
    j = _get("search/result", query=query)
    out = []
    for sec in j.get("sections") or []:
        for it in sec.get("items") or []:
            if it.get("type") in TYPES and ID_RE.match(it.get("id") or ""):
                out.append(_card(it))
    return out


def show(show_id):
    j = _get("detail/collection", type="tvshow", id=show_id)
    seasons = []
    for tab in j.get("tabs") or []:
        if tab.get("type") == "tvshowepisodes":
            seasons = [{"id": c.get("id"), "title": c.get("title"), "seq": c.get("sequence")}
                       for c in tab.get("containers") or []]
    seasons.sort(key=lambda s: s["seq"] or 0, reverse=True)  # newest season first
    return {
        "id": show_id,
        "title": j.get("title"),
        "description": j.get("description"),
        "img": _img(j, ("bigpic", "landscape")),
        "seasons": seasons,
    }


def season(season_id):
    """All episodes of a season, following the API's cursor pagination."""
    eps, seen, params = [], set(), {}
    for _ in range(MAX_SEASON_PAGES):
        j = _get("detail/tab/tvshowepisodes", type="season", id=season_id, **params)
        for it in j.get("items") or []:
            if it.get("id") not in seen:
                seen.add(it.get("id"))
                eps.append(_card(it))
        nxt = j.get("next")
        if not nxt or not j.get("items"):
            break
        params = dict(urllib.parse.parse_qsl(nxt))
    eps.sort(key=lambda e: e["seq"] or 0)
    return eps


def video(kind, vid):
    j = _get("detail/video", type=kind, id=vid)
    if not j.get("id"):
        raise MxError("Title nahi mila")
    url = _hls(j)
    container = j.get("container") or {}
    show_obj = container.get("container") or {}
    return {
        "id": vid,
        "type": kind,
        "title": j.get("title"),
        "description": j.get("description"),
        "duration": j.get("duration"),
        "img": _img(j, ("bigpic", "landscape")),
        "date": (j.get("publishTime") or j.get("releaseDate") or "")[:10],
        "seq": j.get("sequence"),
        "season_id": container.get("id") if kind == "episode" else None,
        "season": container.get("title") if kind == "episode" else None,
        "show_id": show_obj.get("id") if kind == "episode" else None,
        "show": show_obj.get("title") if kind == "episode" else None,
        "hls": url,
        "drm": bool((j.get("stream") or {}).get("drmProtect")),
    }


def parse_url(text):
    """mxplayer.in link -> (type, id), or None."""
    m = re.search(r"mxplayer\.in/detail/(episode|movie|shorts|tvshow|season)/([0-9a-f]{32})", text)
    if m:
        return m.group(1), m.group(2)
    m = re.search(r"mxplayer\.in/(movie|show)/(?:[\w-]+/)*[\w-]*?([0-9a-f]{32})", text)
    if m:
        kind = "movie" if m.group(1) == "movie" else ("season" if "/seasons/" in text else "tvshow")
        return kind, m.group(2)
    return None
