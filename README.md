# 🎬 OTT - Local Tube

> A lightweight, ad-free personal streaming backend & web player for **YouTube**, **Sony LIV**, and **MX Player**. Built with Python 3 in an **MVC (Model-View-Controller)** architecture with zero external web framework dependencies (Python stdlib-only HTTP server).

---

## ✨ Features

- **🚀 Clean MVC Architecture**: Separated into Models, Views, Controllers, and Background Services for maximum maintainability.
- **📺 YouTube Streaming**:
  - Ad-free video and audio stream extraction using vendored `yt-dlp`.
  - Long-lived Node.js worker for solving YouTube JS challenges instantly without per-video startup latency.
  - Background video prefetching and parallel extraction queues.
  - Client-side streaming or bounded-chunk proxy relay (`YT_PROXY=1`).
- **🌟 Sony LIV (Live Catalog & Streams)**:
  - **Dynamic Live Home Feed**: Fetches trending shows, Sony LIV Originals, Comedy, Crime & Thrillers, and Reality Shows directly from Sony LIV's official APIs in parallel.
  - **Dynamic Hero Carousel**: Auto-detects masthead banner artwork for top trending shows.
  - Full show catalogs, seasons, high-res posters, and MPD manifest relays.
- **🍿 MX Player Support**:
  - Direct integration with MX Player's public JSON API.
  - Ad-free HLS stream playback without ads or analytics tracking.
  - Season/episode paginated navigation and hero carousel.
- **⚡ High Performance**:
  - Multi-threaded in-memory `TTLCache` with concurrent in-flight request deduplication.
  - Gzip compression and ETag validation for static web assets.
  - Upstream keep-alive connection pooling.
- **💻 100% Local & Self-Contained**:
  - No database setup or external services required.
  - Simple bash script or single python command to run.

---

## 🏗️ Architecture & Directory Structure

```text
Youtube/
├── app/
│   ├── config.py                 # Global environment configurations & defaults
│   ├── router.py                 # Central HTTP request router & dispatcher
│   │
│   ├── models/                   # [Model] Business logic & External APIs
│   │   ├── __init__.py
│   │   ├── youtube.py            # yt-dlp extraction, stream validator, prefetch queue
│   │   ├── mx.py                 # MX Player API catalog & episode stream resolver
│   │   └── sony.py               # Sony LIV live API, token management, MPD manifest
│   │
│   ├── views/                    # [View] Presentation layer & formatters
│   │   ├── __init__.py
│   │   └── responses.py          # JSON serializers, ETag + Gzip file streaming
│   │
│   ├── controllers/              # [Controller] Request validation & route handlers
│   │   ├── __init__.py
│   │   ├── base.py               # Shared controller utilities
│   │   ├── youtube_controller.py # /api/search, /api/video, /api/prefetch, /api/yt/stream
│   │   ├── mx_controller.py      # /api/mx/* (home, search, show, season, video)
│   │   ├── sony_controller.py    # /api/sony/* & /api/sony/manifest/*
│   │   └── view_controller.py    # Web pages and static assets
│   │
│   └── services/                 # Background utilities & optimizations
│       ├── __init__.py
│       ├── cache.py              # Thread-safe TTL cache with in-flight deduplication
│       ├── network.py            # Upstream HTTP/Socks5 connection pool
│       └── jsc_fast.py           # Node.js persistent worker for YouTube challenges
│
├── static/                       # Web frontend assets
│   ├── index.html                # Responsive player UI & catalog browser
│   └── vendor/                   # HLS.js and Dash.js media engines
│
├── server.py                     # Application entry point
├── run.sh                        # Startup script
├── update.sh                     # Script to update vendored yt-dlp
└── vendor/                       # Vendored yt-dlp standalone bundle
```

---

## 🚀 Quick Start

### Prerequisites
- **Python 3.9+**
- **Node.js** (recommended for YouTube JS challenge solving)

### 1. Clone the repository
```bash
git clone https://github.com/Gyanuog/OTT.git
cd OTT
```

### 2. Run the application
Using the startup script:
```bash
chmod +x run.sh update.sh
./run.sh
```

Or run directly with Python:
```bash
python3 server.py
```

### 3. Open in Browser
Navigate to:
```
http://127.0.0.1:8765
```

---

## ⚙️ Configuration & Environment Variables

You can customize the server behavior using environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `YT_HOST` | `127.0.0.1` | Host address to bind the HTTP server |
| `YT_PORT` | `8765` | Port number for the web server |
| `YT_PROXY` | `0` | Set `1` to proxy YouTube media chunks through server |
| `YT_COOKIES` | `~/.config/localtube/cookies.txt` | Path to YouTube cookies file (helps bypass bot checks) |
| `YT_MAX_PARALLEL` | `3` | Maximum concurrent yt-dlp extraction processes |
| `YT_PROXY_URL` | `""` | Optional SOCKS5 proxy URL for upstream extraction |
| `YT_DEBUG` | `""` | Set to `1` to enable verbose request logging |

### Example: Running on a Custom Port
```bash
YT_PORT=9000 ./run.sh
```

---

## 🔄 Keeping YouTube Extractor Up-to-Date

YouTube frequently updates player algorithms. If YouTube videos ever stop playing, update the vendored `yt-dlp` bundle:
```bash
./update.sh
```

---

## 📄 License
This project is for personal, local educational use. All streamed content rights belong to their respective content owners and platforms.
