#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Building..."
npm run build
echo "Restarting service..."
systemctl restart claude-discord-bot
sleep 2
systemctl status claude-discord-bot --no-pager | head -10
echo "Done."
