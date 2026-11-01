import threading
import time
from app.config import VIDEO_TTL, SEARCH_TTL, MAX_CACHE


class TTLCache:
    """TTL cache with in-flight de-duplication: concurrent requests for the
    same key wait on a single computation instead of each running yt-dlp."""

    def __init__(self, ttl, max_items=MAX_CACHE):
        self.ttl = ttl
        self.max_items = max_items
        self.data = {}
        self.inflight = {}
        self.lock = threading.Lock()

    def has(self, key):
        with self.lock:
            hit = self.data.get(key)
            return bool(hit and hit[0] > time.time()) or key in self.inflight

    def drop(self, key):
        with self.lock:
            self.data.pop(key, None)

    def get(self, key, compute):
        with self.lock:
            hit = self.data.get(key)
            if hit and hit[0] > time.time():
                return hit[1]
            ev = self.inflight.get(key)
            owner = ev is None
            if owner:
                ev = self.inflight[key] = threading.Event()
        if not owner:
            ev.wait()
            with self.lock:
                hit = self.data.get(key)
            if hit:
                return hit[1]
            return self.get(key, compute)  # owner failed; retry ourselves
        try:
            value = compute()
            with self.lock:
                if len(self.data) >= self.max_items:
                    now = time.time()
                    self.data = {k: v for k, v in self.data.items() if v[0] > now}
                    while len(self.data) >= self.max_items:
                        self.data.pop(next(iter(self.data)))
                self.data[key] = (time.time() + self.ttl, value)
            return value
        finally:
            with self.lock:
                self.inflight.pop(key, None)
            ev.set()


# Shared cache instances across the application
video_cache = TTLCache(VIDEO_TTL)
search_cache = TTLCache(SEARCH_TTL)
mx_cache = TTLCache(SEARCH_TTL)      # MX JSON API responses
sony_cache = TTLCache(SEARCH_TTL)    # Sony LIV API responses
