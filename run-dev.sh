#!/bin/bash
# Dev server runner for infranex-bt (mirrors platform .zscripts/dev.sh pattern)
PROJECT_DIR="/home/z/my-project/infranex-bt"
cd "$PROJECT_DIR"
export DATABASE_URL="file:$PROJECT_DIR/db/custom.db"
exec bun run dev
