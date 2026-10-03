#!/bin/sh
# Update the live server: pull the latest code and restart only the game server (the tunnel stays up).
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
cp deploy/tennis-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart tennis-server.service
systemctl --user --no-pager status tennis-server.service | head -3
