# INFRANEX BT - Vercel + Supabase Deployment Guide

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Frontend      │     │    Backend       │     │    Supabase      │
│   (Vercel)      │────▶│    (Vercel)      │────▶│    (PostgreSQL)  │
│   Next.js 15    │     │    FastAPI       │     │    + Auth +      │
│   Static + SSR  │     │    Serverless    │     │    PgBouncer     │
└─────────────────┘     └──────────────────┘     └──────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │   Upstash Redis  │
                     │   (Serverless)   │
                     └──────────────────┘
```

## Prerequisites

- Vercel account
- Supabase account
- Upstash Redis account (free tier)
- GitHub repository connected to Vercel

---

## Step 1: Supabase Setup

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose organization, name (e.g., `infranex-bt`), region
3. Set a strong database password (save it!)
4. Wait for provisioning (~2 minutes)

### 1.2 Run Migrations

In Supabase Dashboard → SQL Editor, run the migration:

```sql
-- Copy contents of database/migrations/001_initial_schema.sql
-- Paste and execute
```

### 1.3 Get Connection Strings

**Settings → Database → Connection String:**

| Type | Use For | Format |
|------|---------|--------|
| **Direct (port 5432)** | Local dev, workers | `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres` |
| **Pooler (port 6543)** | **Vercel serverless** | `postgresql://postgres.[REF]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres` |

**Save both!** You need:
- `DATABASE_URL` = Direct connection (for local dev)
- `DATABASE_POOLER_URL` = Pooler connection (for Vercel)

### 1.4 Get Auth Keys

**Settings → API:**

- `SUPABASE_URL` = Project URL (e.g., `https://xyz.supabase.co`)
- `SUPABASE_ANON_KEY` = `anon` public key
- `SUPABASE_SERVICE_ROLE_KEY` = `service_role` secret key
- `SUPABASE_JWT_SECRET` = JWT secret (for token verification)

### 1.5 Configure Auth Providers (Optional)

**Authentication → Providers:**
- Enable Email/Password
- Enable OAuth (Google, GitHub) if needed
- Set Site URL to your Vercel frontend URL

---

## Step 2: Upstash Redis Setup

1. Go to [upstash.com](https://upstash.com) → Create Database
2. Name: `infranex-bt`, Region: Same as Vercel (iad1 for US East)
3. Type: Redis
4. Copy **REST API URL** and **REST API Token** from database details

These become:
- `UPSTASH_REDIS_REST_URL` = `https://your-db.upstash.io`
- `UPSTASH_REDIS_REST_TOKEN` = `your-token`

---

## Step 3: Vercel Deployment

### 3.1 Deploy Backend

1. In Vercel Dashboard → Add New → Project
2. Import your GitHub repo
3. **Framework Preset**: Other
4. **Root Directory**: `infranex-bt/backend`
5. **Build Command**: (leave empty - auto-detected from `vercel.json`)
6. **Output Directory**: (leave empty)

**Environment Variables** (add all from `.env.production.example`):

| Variable | Source |
|----------|--------|
| `APP_ENV` | `production` |
| `DEPLOYMENT_MODE` | `production` |
| `SUPABASE_URL` | Supabase Settings → API |
| `SUPABASE_ANON_KEY` | Supabase Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Settings → API |
| `SUPABASE_JWT_SECRET` | Supabase Settings → API |
| `DATABASE_URL` | Supabase Settings → Database → Direct |
| `DATABASE_POOLER_URL` | Supabase Settings → Database → Pooler |
| `BITTENSOR_NETWORK` | `finney` |
| `BITTENSOR_RPC_ENDPOINT` | `wss://entrypoint-finney.opentensor.ai:443` |
| `UPSTASH_REDIS_REST_URL` | Upstash Console |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Console |
| `GITHUB_TOKEN` | GitHub Settings → Developer → Personal Access Tokens |
| `CORS_ORIGINS` | Your frontend Vercel URL |
| `SECRET_KEY` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |

7. Deploy → Wait for build to complete
8. Note the backend URL: `https://infranex-backend.vercel.app`

### 3.2 Deploy Frontend

1. In Vercel Dashboard → Add New → Project
2. Import same GitHub repo
3. **Framework Preset**: Next.js
4. **Root Directory**: `infranex-bt/frontend`
5. **Build Command**: `npm run build`
6. **Output Directory**: `.next`

**Environment Variables:**

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://infranex-backend.vercel.app` (your backend URL) |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as backend |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as backend |

7. Deploy → Wait for build
8. Note the frontend URL: `https://infranex-bt.vercel.app`

### 3.3 Update CORS

After frontend deploys, update backend `CORS_ORIGINS`:
```
https://infranex-bt.vercel.app,https://infranex-backend.vercel.app
```

Redeploy backend.

---

## Step 4: Verify Deployment

### 4.1 Health Checks

```bash
# Backend health
curl https://infranex-backend.vercel.app/health/live
curl https://infranex-backend.vercel.app/health/ready

# API
curl https://infranex-backend.vercel.app/api/opportunities/top/10
```

### 4.2 Test Cron Jobs

```bash
# Trigger manually (for testing)
curl -X POST https://infranex-backend.vercel.app/api/cron/market-data \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Check Vercel Dashboard → Functions → Logs for execution.

### 4.3 Test Frontend

Visit `https://infranex-bt.vercel.app`:
- Dashboard loads
- Subnets page shows data
- Opportunities page shows scores
- Login works with Supabase Auth

---

## Step 5: Custom Domains (Optional)

### Frontend
1. Vercel Dashboard → Project → Settings → Domains
2. Add `app.infranex.com` (or your domain)
3. Configure DNS: CNAME → `cname.vercel-dns.com`

### Backend
1. Add `api.infranex.com`
2. Update `CORS_ORIGINS` to include `https://app.infranex.com`
3. Update `NEXT_PUBLIC_API_URL` to `https://api.infranex.com`

---

## Environment Variable Reference

### Backend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_ENV` | ✅ | `production` |
| `DEPLOYMENT_MODE` | ✅ | `production` |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key |
| `SUPABASE_JWT_SECRET` | ✅ | Supabase JWT secret |
| `DATABASE_URL` | ✅ | Direct PostgreSQL connection |
| `DATABASE_POOLER_URL` | ✅ | **PgBouncer pooler for serverless** |
| `BITTENSOR_NETWORK` | ✅ | `finney` (mainnet) or `testnet` |
| `BITTENSOR_RPC_ENDPOINT` | ✅ | Bittensor RPC WebSocket |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash REST API token |
| `GITHUB_TOKEN` | ✅ | GitHub PAT for repo analysis |
| `CORS_ORIGINS` | ✅ | Frontend URL(s) |
| `SECRET_KEY` | ✅ | 32-byte hex secret |
| `CRON_SECRET` | ✅ | 32-byte hex for cron auth |
| `RATE_LIMIT_REQUESTS` | | Default: 100 |
| `RATE_LIMIT_WINDOW_SECONDS` | | Default: 60 |
| `SCANNER_FAST_INTERVAL_SECONDS` | | Default: 300 |
| `SCANNER_MEDIUM_INTERVAL_SECONDS` | | Default: 900 |
| `SCANNER_SLOW_INTERVAL_SECONDS` | | Default: 86400 |
| `DEFAULT_CURRENCY` | | Default: INR |
| `USD_TO_INR` | | Default: 83.5 |

### Frontend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend Vercel URL |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `NEXT_PUBLIC_APP_NAME` | | Default: Infranex BT |

---

## Troubleshooting

### Database Connection Issues

**Error**: `connection refused` / `timeout`
- ✅ Use `DATABASE_POOLER_URL` (port 6543) not direct URL
- ✅ Check Supabase project is not paused
- ✅ Verify password is correct (special chars need URL encoding)

### Cron Jobs Not Running

**Error**: 401/403 on cron endpoints
- ✅ `CRON_SECRET` matches in Vercel env and cron call
- ✅ Cron schedule in `vercel.json` is valid
- ✅ Function timeout > 60s for scanner/scoring

### CORS Errors

**Error**: `Access-Control-Allow-Origin` missing
- ✅ `CORS_ORIGINS` includes frontend URL exactly
- ✅ No trailing slashes in URLs
- ✅ Redeploy backend after changing CORS

### Redis/Upstash Issues

**Error**: `ECONNREFUSED` / auth failed
- ✅ Use `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- ✅ Not standard Redis protocol (uses HTTP REST)
- ✅ Check Upstash database is active

---

## Monitoring & Logs

### Vercel
- **Functions** → View logs for each serverless function
- **Analytics** → Request/response metrics
- **Cron** → Scheduled job execution history

### Supabase
- **Database** → Query performance, connections
- **Auth** → User signups, sessions
- **Logs** → PostgreSQL logs

### Upstash
- **Metrics** → Commands/sec, latency, memory

---

## Cost Estimates (Monthly)

| Service | Free Tier | Pro Tier |
|---------|-----------|----------|
| **Vercel** | 100GB bandwidth, unlimited personal projects | $20/mo for team |
| **Supabase** | 500MB DB, 2GB bandwidth, 50k MAU | $25/mo for 8GB DB |
| **Upstash** | 10k requests/day, 256MB | $0.50/1M requests |

**Estimated production cost**: ~$25-50/month for moderate traffic.

---

## Next Steps After Deployment

1. **Set up monitoring**: Vercel Analytics + Supabase Dashboard
2. **Configure alerts**: Failed cron jobs, high error rates
3. **Add custom domains**: Professional branding
4. **Enable Supabase Realtime**: For live dashboard updates
5. **Set up staging environment**: Preview deployments for PRs

---

## Support

- Vercel Docs: https://vercel.com/docs
- Supabase Docs: https://supabase.com/docs
- Upstash Docs: https://docs.upstash.com