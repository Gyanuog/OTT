"""Sony LIV support: talks to Sony LIV's API directly for unencrypted/encrypted streams.

Fetches categorized home feeds, show catalogs, seasons, high-res episode thumbnails,
and stream manifests (.mpd) with local CORS-free chunk relays.
"""
import datetime
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API_BASE = "https://apiv2.sonyliv.com/AGL"
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.sonyliv.com",
    "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

ID_RE = re.compile(r"^\d{10}$")

FEATURED_SHOWS = [
    {
        "id": "1700000084",
        "title": "Taarak Mehta Ka Ooltah Chashmah",
        "category": "Comedy & Family",
        "desc": "The residents of Gokuldham Society face comical everyday problems and find hilarious solutions together.",
        "poster": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000023233/1788163007499777_TMKOC25_Portrait_Thumb.jpg",
        "img": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000023233/1788162888245777_TMKOC_31aug_landscape_thumbnail.jpg",
        "banner": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000021341/1785331288755758_Tarak_18years_tv_bg.jpg",
        "type": "tvshow",
    },
    {
        "id": "1790007851",
        "title": "Family Full House With Rohit Sharma",
        "category": "Comedy & Family",
        "desc": "Celebrity fun, sports stars, laughter and heartwarming moments with Rohit Sharma and family.",
        "poster": "https://images.slivcdn.com/videoasset_images/manage_file/1000027926/1793452478945641_FFH_31st_Oct_EP13_masthead_logo_rectangular.png",
        "img": "https://images.slivcdn.com/videoasset_images/manage_file/1000027926/1793452736113641_FFH_31st_Oct_EP13_masthead_large_v3.jpg",
        "banner": "https://images.slivcdn.com/videoasset_images/manage_file/1000027926/1793452736113641_FFH_31st_Oct_EP13_masthead_large_v3.jpg",
        "type": "tvshow",
    },
    {
        "id": "1700000196",
        "title": "CID",
        "category": "Crime & Thrillers",
        "desc": "ACP Pradyuman, Daya, and Abhijeet solve intricate, mysterious crimes with forensic science and deductive grit.",
        "poster": "https://origin-staticv2.sonyliv.com/videoasset_images/blitz_assets/1700000196/portraitThumb/1768497082273_1767090801620168_CID_30dec_1400x2100_portrait_thumb.jpg",
        "img": "https://origin-staticv2.sonyliv.com/videoasset_images/blitz_assets/1700000196/thumbnail/1737045597079_CID2024_3_Landscape_Thumb_1.jpg",
        "banner": "https://origin-staticv2.sonyliv.com/videoasset_images/blitz_assets/1700000196/thumbnail/1737045597079_CID2024_3_Landscape_Thumb_1.jpg",
        "type": "tvshow",
    },
    {
        "id": "1700000091",
        "title": "Adaalat",
        "category": "Crime & Thrillers",
        "desc": "KD Pathak is an enigmatic lawyer with an undefeated record who defends the innocent in baffling murder trials.",
        "poster": "https://origin-staticv2.sonyliv.com/videoasset_images/blitz_assets/1700000091/portraitThumb/1768497090728_1767094469212168_Adaalat_30dec_1400x2100_portrait_thumb.jpg",
        "img": "https://origin-staticv2.sonyliv.com/landscape_thumb/Adaalat1_landscape_Thumb.jpg",
        "banner": "https://origin-staticv2.sonyliv.com/landscape_thumb/Adaalat1_landscape_Thumb.jpg",
        "type": "tvshow",
    },
    {
        "id": "1700000292",
        "title": "Scam 1992: The Harshad Mehta Story",
        "category": "Sony LIV Originals",
        "desc": "Set in 1980s and 90s Bombay, follow the meteoric rise and catastrophic fall of stockbroker Harshad Mehta.",
        "poster": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000017580/1777451891351139_scam1992_29april_portrait_thumb.jpg",
        "img": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000017580/1777456552287139_scam1992_29april_landscape_thumb.jpg",
        "banner": "https://images.slivcdn.com/videoasset_images/manage_file/1000027912/1793435692019659_SCAM2010_masthead_large_v3_3200x1800.jpg",
        "type": "tvshow",
    },
    {
        "id": "1700000659",
        "title": "Gullak",
        "category": "Sony LIV Originals",
        "desc": "Set in quaint by-lanes of central India, explore the endearing, relatable, and bittersweet stories of the Mishra family.",
        "poster": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000026087/179160925756576_GULLAK5_Portrait_Thumb_r1.jpg",
        "img": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000026087/179160896036876_GULLAK5_Landscape_Thumb_r1.jpg",
        "banner": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000026087/179160896036876_GULLAK5_Landscape_Thumb_r1.jpg",
        "type": "tvshow",
    },
    {
        "id": "1700000725",
        "title": "Maharani",
        "category": "Sony LIV Originals",
        "desc": "A gripping political drama set in Bihar in the 1990s, where an unexpected housewife takes the Chief Minister seat.",
        "poster": "https://origin-staticv2.sonyliv.com/videoasset_images/blitz_assets/1700000725/portraitThumb/1768496878644_176567269254172_Maharani_13dec_portrait_thumb_1400x2100_NS.jpg",
        "img": "https://origin-staticv2.sonyliv.com/videoasset_images/blitz_assets/1700000725/landscapeThumb/1762431309990_./MaharaniS4_3_Landscape_Thumb.jpg",
        "banner": "https://origin-staticv2.sonyliv.com/videoasset_images/blitz_assets/1700000725/landscapeThumb/1762431309990_./MaharaniS4_3_Landscape_Thumb.jpg",
        "type": "tvshow",
    },
    {
        "id": "1700000195",
        "title": "Kaun Banega Crorepati",
        "category": "Reality & Game Shows",
        "desc": "The iconic quiz game show hosted by Amitabh Bachchan, testing knowledge and changing lives across India.",
        "poster": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000027596/1793161020000256_KBC25_26_3_Portrait_Thumb.jpg",
        "img": "https://origin-staticv2.sonyliv.com/videoasset_images/manage_file/1000027596/1793161020000256_KBC25_26_3_Landscape_Thumb.jpg",
        "banner": "https://images.slivcdn.com/videoasset_images/manage_file/1000027925/1793450687898211_KHC_31st_Oct_Ep18_masthead_large_v3.jpg",
        "type": "tvshow",
    },
    {
        "id": "1790007916",
        "title": "Indian Idol - Legends Return",
        "category": "Reality & Game Shows",
        "desc": "India's premier musical stage, discovering powerhouse vocalists and the next singing superstars.",
        "poster": "https://images.slivcdn.com/videoasset_images/manage_file/1000027929/1793456636231854_IDOL_returns_episdoe_masthead_large_v3.jpg",
        "img": "https://images.slivcdn.com/videoasset_images/manage_file/1000027929/1793456636231854_IDOL_returns_episdoe_masthead_large_v3.jpg",
        "banner": "https://images.slivcdn.com/videoasset_images/manage_file/1000027929/1793456636231854_IDOL_returns_episdoe_masthead_large_v3.jpg",
        "type": "tvshow",
    },
    {
        "id": "1700000007",
        "title": "Beyhadh",
        "category": "Crime & Thrillers",
        "desc": "Maya's obsessive, dangerous love for Arjun crosses all boundaries, spiraling into a thrilling psychological drama.",
        "poster": "https://origin-staticv2.sonyliv.com/videoasset_images/blitz_assets/1700000007/portraitThumb/1768497089742_1767094063203168_Beyhadh_30dec_1400x2100_portrait_thumb.jpg",
        "img": "https://origin-staticv2.sonyliv.com/videoasset_images/beyhadh_a_landscape_image_re1_21dec.jpg",
        "banner": "https://origin-staticv2.sonyliv.com/videoasset_images/beyhadh_a_landscape_image_re1_21dec.jpg",
        "type": "tvshow",
    },
]

_token_lock = threading.Lock()
_cached_token = None
_token_expiry = 0


class SonyError(Exception):
    pass


def _fmt_date(val):
    if not val:
        return ""
    if isinstance(val, (int, float)):
        try:
            return datetime.datetime.fromtimestamp(val / 1000 if val > 1e11 else val).strftime("%Y-%m-%d")
        except Exception:
            return ""
    return str(val)[:10]


def _get_token():
    global _cached_token, _token_expiry
    now = time.time()
    with _token_lock:
        if _cached_token and _token_expiry > now:
            return _cached_token
        req = urllib.request.Request(f"{API_BASE}/1.4/A/ENG/WEB/ALL/GETTOKEN", headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as r:
            j = json.loads(r.read())
            token = j.get("resultObj")
            if not token:
                raise SonyError("Security token nahi mila")
            _cached_token = token
            _token_expiry = now + 12 * 3600
            return _cached_token


def _drop_token():
    global _cached_token, _token_expiry
    with _token_lock:
        _cached_token, _token_expiry = None, 0


def _api(path, **params):
    url = f"{API_BASE}/{path}"
    if params:
        clean_params = {k.rstrip("_"): v for k, v in params.items()}
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(clean_params)
    last = None
    for attempt in range(2):  # one retry: flaky TLS handshakes and expired tokens
        try:
            req = urllib.request.Request(url, headers={**HEADERS, "security_token": _get_token()})
            with urllib.request.urlopen(req, timeout=12) as r:
                return json.loads(r.read()).get("resultObj")
        except urllib.error.HTTPError as e:
            if e.code == 406:  # VIDEOURL answers 406 for subscription-only titles
                raise SonyError("Ye Premium (subscription) wala title hai — free mein nahi chalta.")
            if e.code in (401, 403):
                _drop_token()
            elif e.code < 500:
                raise SonyError(f"Sony LIV API error: HTTP {e.code}")
            last = e
        except SonyError:
            raise
        except Exception as e:
            last = e
    raise SonyError(f"Sony LIV API error: {last}")


def _parse_card(item, default_cat="Show"):
    m = item.get("metadata") or {}
    emf = m.get("emfAttributes") or {}
    cid = str(m.get("contentId") or item.get("id") or "")
    title = m.get("title") or m.get("episodeTitle") or item.get("title") or ""
    if not cid or not title:
        return None

    poster = (
        emf.get("img_poster_2000_3000")
        or emf.get("portrait_thumb")
        or emf.get("image_600x900_clean")
        or emf.get("apv_cover_art")
        or m.get("pictureUrl")
    )
    img = (
        emf.get("landscape_thumb")
        or emf.get("img_tile_3840_2160")
        or emf.get("thumbnail")
        or emf.get("image_1920x1080_clean")
        or emf.get("masthead_background")
        or poster
    )
    banner = (
        emf.get("masthead_large_v3")
        or emf.get("masthead_large_v2")
        or emf.get("masthead_background")
        or emf.get("tv_background_image")
        or img
    )
    desc = m.get("shortDescription") or m.get("longDescription") or ""
    genres = m.get("genres") or []
    cat = genres[0] if genres else (emf.get("sub_genre") or default_cat)

    return {
        "id": cid,
        "title": title,
        "category": cat,
        "desc": desc,
        "poster": poster or img,
        "img": img or poster,
        "banner": banner,
        "type": "tvshow",
    }


def _fetch_tray(title, q, default_cat="Show"):
    try:
        data = _api("4.8/A/ENG/WEB/IN/ALL/TRAY/SEARCH", query=q, from_=0, to=15, app_version="3.6.86") or {}
        items = []
        seen = set()
        for c in data.get("containers", []):
            for sub in c.get("containers", []):
                card = _parse_card(sub, default_cat)
                if card and card["id"] not in seen:
                    seen.add(card["id"])
                    items.append(card)
            for tab in c.get("containers", []):
                for a in tab.get("assets", []):
                    card = _parse_card(a, default_cat)
                    if card and card["id"] not in seen:
                        seen.add(card["id"])
                        items.append(card)
        return {"title": title, "items": items[:15]}
    except Exception:
        return {"title": title, "items": []}


def home():
    """Live categorized home feed fetched directly from Sony LIV's official API."""
    tray_configs = [
        ("Top Trending Shows", "", "Popular"),
        ("Sony LIV Originals", "originals", "Originals"),
        ("Comedy & Family", "comedy", "Comedy"),
        ("Crime & Thrillers", "crime", "Crime"),
        ("Reality & Game Shows", "reality", "Reality"),
    ]

    try:
        with ThreadPoolExecutor(max_workers=5) as pool:
            rows = list(pool.map(lambda c: _fetch_tray(c[0], c[1], c[2]), tray_configs))
        rows = [r for r in rows if r["items"]]

        # Extract top items with banners for the hero carousel
        hero_items = []
        seen_hero = set()
        for r in rows:
            for it in r["items"]:
                if it.get("banner") and it["id"] not in seen_hero:
                    seen_hero.add(it["id"])
                    hero_items.append(it)
                if len(hero_items) >= 5:
                    break
            if len(hero_items) >= 5:
                break

        if rows:
            return {
                "hero": hero_items,
                "rows": rows,
            }
    except Exception:
        pass

    # Fallback to featured shows if network/API fails
    hero_items = [it for it in FEATURED_SHOWS if it.get("banner")][:5]
    categories = [
        "All Popular Shows",
        "Comedy & Family",
        "Crime & Thrillers",
        "Sony LIV Originals",
        "Reality & Game Shows",
    ]
    fallback_rows = []
    for cat in categories:
        items = FEATURED_SHOWS if cat == "All Popular Shows" else [it for it in FEATURED_SHOWS if it.get("category") == cat]
        if items:
            fallback_rows.append({"title": cat, "items": items})
    return {"hero": hero_items, "rows": fallback_rows}


def search(query):
    """Search shows via Sony LIV's live catalog API with featured fallback, or parse direct link / numeric ID."""
    direct = parse_url(query)
    if direct:
        return {"direct": {"type": direct[0], "id": direct[1]}}
    
    q = query.lower().strip()
    
    # Try Sony LIV live search API first
    try:
        data = _api(
            "4.8/A/ENG/WEB/IN/ALL/TRAY/SEARCH",
            query=q,
            from_=0,
            to=25,
            app_version="3.6.86",
        )
        live_results = []
        seen = set()
        for sec in (data or {}).get("containers", []):
            for tab in sec.get("containers", []):
                for asset in tab.get("assets", []):
                    aid = str(asset.get("id") or asset.get("contentId") or "")
                    if not aid or aid in seen:
                        continue
                    seen.add(aid)
                    meta = asset.get("metadata", {})
                    emf = meta.get("emfAttributes", {})
                    title = meta.get("title") or meta.get("episodeTitle") or asset.get("title")
                    if not title:
                        continue
                    poster = emf.get("portrait_thumb") or emf.get("poster")
                    img = emf.get("landscape_thumb") or emf.get("thumbnail")
                    desc = meta.get("shortDescription") or meta.get("longDescription") or ""
                    # 170... or 179... is TV show
                    kind = "tvshow" if aid.startswith(("170", "179")) or asset.get("layout") == "BUNDLE_ITEM" else "episode"
                    live_results.append({
                        "id": aid,
                        "title": title,
                        "poster": poster or img,
                        "img": img or poster,
                        "desc": desc[:140],
                        "type": kind,
                    })
        if live_results:
            return {"results": live_results}
    except Exception:
        pass

    # Fallback to featured catalog keyword scoring
    words = [w for w in re.split(r"\s+", q) if len(w) > 1]
    def score(it):
        t = it["title"].lower()
        d = (it.get("desc") or "").lower()
        c = (it.get("category") or "").lower()
        if q in t:
            return 100
        matches = sum(1 for w in words if w in t or w in d or w in c)
        return matches

    matched = []
    for it in FEATURED_SHOWS:
        s = score(it)
        if s > 0:
            matched.append((s, it))
    matched.sort(key=lambda x: x[0], reverse=True)
    return {"results": [x[1] for x in matched]}


def show(show_id):
    """Get show details, high-res posters, banner, and seasons."""
    obj = _api(f"1.9/R/ENG/WEB/IN/DL/DETAIL/{show_id}", kids_safe="false", **{"from": "0", "to": "49"})
    if not obj or not obj.get("containers"):
        raise SonyError("Show nahi mila")
    c0 = obj["containers"][0]
    meta = c0.get("metadata", {})
    emf = meta.get("emfAttributes", {})
    raw_seasons = c0.get("containers", [])
    
    seasons = []
    for idx, s in enumerate(raw_seasons):
        s_id = str(s.get("id"))
        s_meta = s.get("metadata", {})
        title = s_meta.get("title") or f"Season {idx + 1}"
        seasons.append({"id": s_id, "title": title, "seq": idx + 1})

    poster = emf.get("portrait_thumb") or emf.get("poster")
    landscape = emf.get("landscape_thumb") or emf.get("thumbnail")
    bg = emf.get("tv_background_image") or emf.get("detail_cover_bg_V2") or emf.get("masthead_large_v3") or landscape

    return {
        "id": str(show_id),
        "title": meta.get("title") or "Sony LIV Show",
        "description": meta.get("longDescription") or meta.get("shortDescription") or "",
        "img": landscape or poster,
        "poster": poster or landscape,
        "bg": bg,
        "seasons": seasons,
    }


def season(season_id):
    """Get all episodes of a season with high-res thumbnails and metadata.

    The API returns at most 100 episodes per call (CID season 1 has 1500+), so the
    remaining pages are fetched in parallel using the season's `total`."""
    page = 100

    def fetch(start):
        obj = _api(f"1.4/R/ENG/WEB/IN/CONTENT/DETAIL/BUNDLE/{season_id}", **{
            "from": str(start),
            "to": str(start + page - 1),
            "orderBy": "episodeNumber",
            "sortOrder": "asc",
        })
        if not obj or not obj.get("containers"):
            return None
        return obj["containers"][0]

    first = fetch(0)
    if not first:
        return []
    raw_eps = list(first.get("containers", []))
    meta0 = first.get("metadata") or {}
    total = min(int(meta0.get("episodeCount") or first.get("total") or 0), 3000)
    starts = list(range(page, total, page))
    if starts:
        pages = [None] * len(starts)

        def worker(i):
            try:
                c = fetch(starts[i])
                pages[i] = c.get("containers", []) if c else []
            except SonyError:
                pages[i] = []

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(len(starts))]
        for i in range(0, len(threads), 8):  # at most 8 requests at once
            batch = threads[i:i + 8]
            for t in batch:
                t.start()
            for t in batch:
                t.join()
        for p in pages:
            raw_eps.extend(p)
    eps = []
    for it in raw_eps:
        meta = it.get("metadata", {})
        emf = meta.get("emfAttributes", {})
        vid = str(it.get("id"))
        seq = meta.get("episodeNumber") or 0
        title = meta.get("episodeTitle") or meta.get("title") or f"Episode {seq}"
        dur = meta.get("duration")
        img = emf.get("landscape_thumb") or emf.get("thumbnail")
        poster = emf.get("poster") or emf.get("portrait_thumb")
        eps.append({
            "type": "episode",
            "id": vid,
            "title": title,
            "img": img or poster,
            "poster": poster or img,
            "duration": dur,
            "seq": seq,
            "date": _fmt_date(meta.get("lastBroadcastDate") or meta.get("originalAirDate")),
            "show": meta.get("title"),
            "desc": (meta.get("longDescription") or meta.get("shortDescription") or "")[:240],
            "playable": True,
        })
    return eps


def video(vid):
    """Get playback details for an episode: .mpd URL, poster, DRM status, and parent IDs."""
    vod = _api(f"1.5/A/ENG/WEB/IN/CONTENT/VIDEOURL/VOD/{vid}")
    if not vod or not vod.get("videoURL"):
        raise SonyError("Video URL nahi mila ya locked hai")

    meta = {}
    parents = []
    try:
        det = _api(f"1.6/A/ENG/WEB/IN/DETAIL/{vid}")
        if det and det.get("containers"):
            c0 = det["containers"][0]
            meta = c0.get("metadata", {})
            parents = c0.get("parents", [])
    except Exception:
        pass

    video_url = vod.get("videoURL")
    emf = meta.get("emfAttributes") or {}
    poster = (vod.get("posterURL") or emf.get("landscape_thumb") or emf.get("thumbnail")
              or emf.get("portrait_thumb") or "")
    is_encrypted = bool(vod.get("isEncrypted"))
    title = meta.get("episodeTitle") or meta.get("title") or f"Episode {vid}"

    season_id = next((str(p["parentId"]) for p in parents if p.get("parentType") == "BUNDLE"), None)
    show_id = next((str(p["parentId"]) for p in parents if p.get("parentType") == "GROUP_OF_BUNDLES"), None)

    return {
        "id": str(vid),
        "type": "episode",
        "title": title,
        "description": meta.get("longDescription") or meta.get("shortDescription") or "",
        "duration": meta.get("duration"),
        "img": poster,
        "date": _fmt_date(meta.get("lastBroadcastDate") or meta.get("originalAirDate")),
        "seq": meta.get("episodeNumber"),
        "season_id": season_id,
        "show_id": show_id,
        "show": meta.get("title"),
        "mpd": video_url,
        "drm": is_encrypted,
    }


def parse_url(text):
    """sonyliv.com link or numeric id -> (type, id), or None."""
    text = text.strip()
    if ID_RE.match(text):
        if text.startswith("170") or text.startswith("179"):
            return "tvshow", text
        if text.startswith("150"):
            return "season", text
        return "episode", text

    m = re.search(r"sonyliv\.com/shows/[^/?#&]+-(\d{10})", text)
    if m:
        return "tvshow", m.group(1)

    m = re.search(r"sonyliv\.com/[^/?#&]+-(\d{10})", text)
    if m:
        return "episode", m.group(1)

    return None
