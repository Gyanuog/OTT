#!/usr/bin/env bash
# Update the vendored yt-dlp (run this when videos stop playing).
cd "$(dirname "$0")" && python3 vendor/yt-dlp -U
