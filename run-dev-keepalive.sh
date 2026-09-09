#!/bin/bash
# Resilient dev-server keepalive for infranex-bt.
# Restarts the Next.js dev server automatically if it dies (OOM, signals, etc.)
PROJECT_DIR="/home/z/my-project/infranex-bt"
cd "$PROJECT_DIR"
export DATABASE_URL="file:$PROJECT_DIR/db/custom.db"

while true; do
  bun run dev >> dev.log 2>&1
  echo "[$(date '+%H:%M:%S')] dev server exited (code $?), restarting in 3s..." >> dev.log
  sleep 3
done
