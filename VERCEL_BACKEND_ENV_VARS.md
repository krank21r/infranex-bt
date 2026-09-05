# Vercel Backend Project (`infranex-bt-backend`) — env vars to set
# Open: https://vercel.com/kranthi21r-gmailcoms-projects/infranex-bt-backend/settings/environment-variables
# For each row: paste Key | paste Value | click Save
#
# The Value column is the right-hand cell (NOT a missing field).
# Each row is committed by clicking Save — there is no global Save button.

| Key | Value |
|-----|-------|
| SUPABASE_URL | https://xwpahwecneudzoklxumg.supabase.co |
| SUPABASE_ANON_KEY | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGFod2VjbmV1ZHpva2x4dW1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjgwNTcsImV4cCI6MjEwMzUwNDA1N30.rzJO0E-g27wcFrx2_XLJxjIsO7JHToFAd5RowXSHgsk |
| SUPABASE_SERVICE_ROLE_KEY | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGFod2VjbmV1ZHpva2x4dW1nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzkyODA1NywiZXhwIjoyMTAzNTA0MDU3fQ.qMiBbGUnLuicWLdgDS9dSbAbLzu6CUQFFsoNVDJ4M9c |
| SUPABASE_JWT_SECRET | (leave blank for now — not strictly required; backend uses service_role for DB writes) |
| DATABASE_URL | postgresql://postgres.xwpahwecneudzoklxumg:xkbjtQuTTHFLR9Bg@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres |
| DATABASE_POOLER_URL | postgresql://postgres.xwpahwecneudzoklxumg:xkbjtQuTTHFLR9Bg@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres |
| CORS_ORIGINS | https://infranex-bt.vercel.app,https://infranex-bt-backend.vercel.app,http://localhost:3000 |
| DEPLOYMENT_MODE | production |
| APP_ENV | production |

# Set each in: Production  (Production scope = Production only checkbox)
# Skip Celery / Redis / GitHub / Bittensor for now — they're only needed for scanners,
# which run via Vercel Cron after everything is healthy. Mock mode also works without them.
