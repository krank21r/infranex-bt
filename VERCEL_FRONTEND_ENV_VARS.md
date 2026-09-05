# Vercel Frontend Project (`infranex-bt`) — env vars to set
# Open: https://vercel.com/kranthi21r-gmailcoms-projects/infranex-bt/settings/environment-variables
# For each row: paste Key | paste Value | click Save

| Key | Value |
|-----|-------|
| NEXT_PUBLIC_API_URL | https://infranex-bt-backend.vercel.app/api |
| NEXT_PUBLIC_SUPABASE_URL | https://xwpahwecneudzoklxumg.supabase.co |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGFod2VjbmV1ZHpva2x4dW1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjgwNTcsImV4cCI6MjEwMzUwNDA1N30.rzJO0E-g27wcFrx2_XLJxjIsO7JHToFAd5RowXSHgsk |

# Note: NEXT_PUBLIC_API_URL = ".../api" (include /api because lib/api.ts already appends endpoints
# like /subnets, /health, /monitoring/overview which the Vercel catch-all routes to FastAPI).
# Scope: Production only.
