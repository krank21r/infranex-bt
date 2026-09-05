# ============================================
# INFRANEX BT - Deployment Guide
# ============================================

## Prerequisites

1. Supabase project: https://supabase.com/dashboard/project/xwpahwecneudzoklxumg
2. Vercel frontend: https://vercel.com/kranthi21r-gmailcoms-projects/infranex-bt
3. Vercel backend: https://vercel.com/kranthi21r-gmailcoms-projects/infranex-bt-backend
4. GitHub repo: https://github.com/krank21r/infranex-bt

---

## Step 1: Apply Database Migrations

Run the migration script to create all tables in Supabase:

```bash
cd backend
python scripts/apply_migrations.py
```

Or manually run the SQL files in Supabase SQL Editor in this order:
1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_approval_audit_drift.sql`
3. `database/migrations/003_learning_engine.sql`
4. `database/migrations/004_anon_read_policies.sql`

---

## Step 2: Get Supabase Credentials

From Supabase Dashboard → Settings → API:

1. **Project URL**: `https://xwpahwecneudzoklxumg.supabase.co`
2. **anon public key**: Copy from "API Keys" section
3. **service_role key**: Copy from "API Keys" section (keep secret!)
4. **JWT Secret**: Copy from "JWT Settings" (optional but recommended)

---

## Step 3: Configure Backend Vercel Environment Variables

Go to: https://vercel.com/kranthi21r-gmailcoms-projects/infranex-bt-backend/settings/environment-variables

Add these variables:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://xwpahwecneudzoklxumg.supabase.co` |
| `SUPABASE_ANON_KEY` | `<your-anon-key>` |
| `SUPABASE_SERVICE_ROLE_KEY` | `<your-service-role-key>` |
| `DATABASE_POOLER_URL` | `postgresql://postgres.xwpahwecneudzoklxumg:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres` |
| `SECRET_KEY` | Generate with `openssl rand -hex 32` |
| `CRON_SECRET` | Generate with `openssl rand -hex 32` |
| `CORS_ORIGINS` | `https://infranex-bt.vercel.app,https://infranex-bt-backend.vercel.app` |
| `APP_ENV` | `production` |
| `DEPLOYMENT_MODE` | `production` |
| `UPSTASH_REDIS_REST_URL` | `<your-upstash-redis-url>` (optional) |
| `UPSTASH_REDIS_REST_TOKEN` | `<your-upstash-token>` (optional) |

**Note**: The `DATABASE_POOLER_URL` uses the connection string from Supabase Dashboard → Settings → Database → Connection Pooler.

---

## Step 4: Configure Frontend Vercel Environment Variables

Go to: https://vercel.com/kranthi21r-gmailcoms-projects/infranex-bt/settings/environment-variables

Add these variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xwpahwecneudzoklxumg.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<your-anon-key>` |
| `SUPABASE_SERVICE_ROLE_KEY` | `<your-service-role-key>` |
| `NEXT_PUBLIC_API_URL` | `https://infranex-bt-backend.vercel.app` |

**Important**: After adding environment variables, you must **redeploy** both projects for changes to take effect.

---

## Step 5: Seed Database with Initial Data

After migrations are applied and backend is deployed:

```bash
cd backend
python scripts/seed_data.py
```

This will populate:
- 33 Bittensor subnets
- Metrics for each subnet
- Neurons/miners per subnet
- Opportunity scores

---

## Step 6: Configure Vercel Cron Jobs

The `vercel.json` files already contain cron configurations. After deploying:

1. **Frontend Cron** (in root `vercel.json`):
   - `/api/cron/scanner` — every 5 minutes
   - `/api/cron/scoring` — every 15 minutes
   - `/api/cron/market` — every hour

2. **Backend Cron** (in `backend/vercel.json`):
   - Ensure cron endpoints are accessible

Vercel Cron automatically sends requests to these endpoints with the `CRON_SECRET` header.

---

## Step 7: Deploy

```bash
# Push any local changes to GitHub
git add .
git commit -m "fix: configure env vars and seed data for live deployment"
git push origin main

# Vercel will auto-deploy both projects
```

---

## Step 8: Verify

After deployment, check these URLs:

1. **Frontend**: https://infranex-bt.vercel.app
   - Should show dashboard with data
   - DataSourceBanner should show "Supabase direct" or "Backend API"

2. **Backend Health**: https://infranex-bt-backend.vercel.app/api/health
   - Should return `{"status": "healthy"}`

3. **Backend Readiness**: https://infranex-bt-backend.vercel.app/api/health/ready
   - Should show `database: healthy`

4. **API Test**: https://infranex-bt-backend.vercel.app/api/subnets
   - Should return list of subnets

---

## Troubleshooting

### "Probing data source..." persists
- Check browser console for errors
- Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in Vercel
- Check if Supabase anon key has SELECT permissions on tables

### "No scores yet" on dashboard
- Run `python scripts/seed_data.py`
- Check if `opportunity_scores` table has data in Supabase
- Verify backend `/api/opportunities/top/10` returns data

### Backend returns 500 errors
- Check Vercel backend logs
- Verify `DATABASE_POOLER_URL` is correct
- Ensure Supabase service role key is set
- Check if database migrations were applied

### CORS errors
- Verify `CORS_ORIGINS` includes frontend URL
- Check Supabase RLS policies allow anon reads

---

## Security Notes

1. **Never commit `.env` files** — they contain secrets
2. **Service role key** — only use server-side, never expose to browser
3. **JWT Secret** — store securely, use for token validation
4. **Database password** — the pooler password is in `apply_migrations.py` — consider rotating it
5. **Rate limiting** — configured in backend, adjust as needed

---

## Architecture

```
Browser
  │
  ├─── Supabase Direct (client-side)
  │       └─── Supabase PostgreSQL (via anon key + RLS)
  │
  └─── Backend API Fallback
          └─── Vercel Frontend (/api/* rewrite)
                  └─── Vercel Backend (FastAPI serverless)
                          ├─── Supabase PostgreSQL (via pooler)
                          ├─── Redis/Upstash (caching)
                          └─── Vercel Cron (data scanning)
```
