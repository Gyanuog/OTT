#!/usr/bin/env bash
# Start Local Tube. Usage: ./run.sh   (YT_PORT=9000 ./run.sh for another port)
# YouTube cookies (for "confirm you're not a bot" blocks) are read from
# ~/.config/localtube/cookies.txt unless YT_COOKIES points elsewhere.
cd "$(dirname "$0")" && YT_COOKIES="${YT_COOKIES:-$HOME/.config/localtube/cookies.txt}" exec python3 -OO server.py
