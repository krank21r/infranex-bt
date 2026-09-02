# Infranex BT — Bittensor Scanner Worker

This container runs the **live Bittensor chain data scanner**. It is
deployed separately from the FastAPI service because the `bittensor>=9.x`
SDK has heavy native dependencies (Rust toolchain at build, ~150 MB
image) that exceed Vercel's 250 MB serverless bundle cap.

The worker writes to the **same Supabase Postgres + Upstash Redis** the
FastAPI service reads from, so the API serves live data without ever
loading the bittensor SDK itself.

## Architecture

```
Bittensor chain (finney / testnet)
        │
        ▼
   this worker ──── scan every 5min
        │
        ▼ writes subnets, metrics, neurons, emissions, incentives
   Supabase Postgres  ◀── FastAPI on Vercel reads here
        │
        ▼ also writes a Redis-shaped "latest" view
   Upstash Redis  ◀── FastAPI on Vercel serves from here
```

## Two ways to run

### 1. Long-lived loop (recommended for production)

A single process that scans every `SCANNER_FAST_INTERVAL_SECONDS` (default
300s) until SIGTERM. Ideal for Fly.io / Railway / a small VPS.

```bash
docker build -t infranex-bt-worker -f worker/Dockerfile .
docker run --rm --env-file .env.production infranex-bt-worker --loop
```

### 2. One-shot cron (cheapest)

A scan runs to completion and the container exits. Schedule with any
external cron. Cheaper than a long-lived VM on metered platforms.

```bash
docker run --rm --env-file .env.production infranex-bt-worker
```

## Environment variables

Same names the FastAPI service uses — one `.env.production` works for
both. The worker only needs the ones marked required.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Asyncpg URL to Supabase Postgres direct connection. |
| `DATABASE_POOLER_URL` | recommended | — | Supabase PgBouncer (port 6543) for serverless deploys. The worker uses `DATABASE_URL`. |
| `UPSTASH_REDIS_REST_URL` | yes (cache writes) | — | Upstash REST endpoint. |
| `UPSTASH_REDIS_REST_TOKEN` | yes (cache writes) | — | Upstash bearer token. |
| `REDIS_URL` | alternative | — | TCP Redis URL. Used if `APP_ENV != "production"`. |
| `DEPLOYMENT_MODE` | yes | `mock` | Set to `production` to select `RealBittensorClient`. |
| `BITTENSOR_NETWORK` | yes | `testnet` | `finney` for mainnet, `testnet` for staging. |
| `BITTENSOR_RPC_ENDPOINT` | no | depends on network | Override the SDK's default endpoint (e.g. wss://...). |
| `SCANNER_FAST_INTERVAL_SECONDS` | no | `300` | Seconds between scans in `--loop` mode. |
| `LOG_LEVEL` | no | `INFO` | Standard Python level. |

## Deploying to Fly.io (recommended)

```toml
# fly.toml
app = "infranex-bt-worker"
primary_region = "iad"

[build]
  dockerfile = "worker/Dockerfile"

[[services]]
  internal_port = 8080
  protocol = "tcp"
  # no public port — worker is internal-only

[env]
  APP_ENV = "production"
  DEPLOYMENT_MODE = "production"
  BITTENSOR_NETWORK = "finney"
  SCANNER_FAST_INTERVAL_SECONDS = "300"
  # DATABASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
  # are set via `fly secrets set`
```

```bash
fly launch --no-deploy
fly secrets set \
  DATABASE_URL="postgresql+asyncpg://postgres:...@db.<ref>.supabase.co:5432/postgres" \
  UPSTASH_REDIS_REST_URL="https://<name>.upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="<token>"
fly deploy
```

The worker image is ~250 MB and stays warm on Fly's smallest shared-cpu
instance ($1.94/month at time of writing). One worker is enough for the
discovery cadence; scale horizontally if you add per-netuid GPU jobs
or emissions backfill.

## Deploying to Railway

```bash
railway init
railway up --dockerfile worker/Dockerfile
# Set the same env vars in the Railway dashboard
# CMD is overridden in the dashboard to: python /app/worker_main.py --loop
```

## Deploying to a $5 VPS (cheapest)

```bash
# On the VPS
git clone <repo>
cd infranex-bt
cp .env.production .
docker build -t infranex-bt-worker -f worker/Dockerfile .
docker run -d --name scanner --restart=unless-stopped \
  --env-file .env.production infranex-bt-worker --loop
docker logs -f scanner
```

## Switching from testnet to mainnet

```bash
# Testnet (free, no TAO value)
fly secrets set BITTENSOR_NETWORK=testnet
fly deploy

# Mainnet (real emissions, real TAO)
fly secrets set BITTENSOR_NETWORK=finney
fly deploy
```

A redeploy is required for the env change to take effect.

## Verifying it's working

```bash
fly logs -a infranex-bt-worker
# Look for lines like:
#   scanner_done subnets=128 neurons=... errors=0 source=bittensor_sdk
# source=bittensor_sdk means the real SDK was used (vs fake_bittensor)
```

Then in your Vercel API:
```bash
curl https://infranex-bt.vercel.app/api/health/details | jq .checks.bittensor
```

## Why this isn't on Vercel

| Constraint | Vercel | This worker |
|---|---|---|
| Bundle size limit | 250 MB | Unlimited |
| Build time limit | 45s | No hard limit |
| Native dependencies | Restricted | Full Linux userland |
| Long-running process | 10s–300s max | Days, weeks |
| `bittensor>=9.x` | Incompatible | Native fit |

Trying to bundle `bittensor` into the FastAPI Vercel deploy is the
single biggest blocker and the reason the rest of the API has to read
from the cache rather than hit the chain directly.
