# Infranex BT

**Bittensor Intelligence & Mining Operations Platform**

A production-ready Next.js dashboard for the Bittensor network — live chain data, GPU pricing, and a full miner deployment engine.

---

## Overview

Infranex BT gives you a single pane for every Bittensor subnet you track: live scores, miner counts, TAO staked, alpha prices, GPU offers, and a deployment engine that provisions GPU servers and launches miners.

### Live data sources

| Source | Data | Refresh |
|--------|------|---------|
| **Bittensor Finney chain** | 16 subnets — miner counts, TAO staked, alpha prices, tempo, emission status | 30s |
| **CoinGecko** | TAO/USD price, market cap, 24h change | 30s |
| **RunPod GraphQL API** | 21 live GPU offers across 45 types (spot + on-demand prices) | 60s |

### Features

- **8 views**: Dashboard, Opportunities, Subnets, GPU Catalog, My Miners, Deployments, Analytics, System & Errors
- **Deployment engine**: 11-state machine (requested → started), config builder (docker image, miner command, ports, env vars), Mock + RunPod provider adapters, SQLite/Postgres persistence
- **System health**: live health checks for chain/price/API/GPU dependencies, client-side runtime error log, resolution steps
- **Dark editorial theme** with Fraunces serif + Inter Tight + JetBrains Mono

### Tech stack

- **Framework**: Next.js 16 (App Router, standalone output)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Database**: Prisma ORM (PostgreSQL on Neon)
- **Live data**: @polkadot/api (Bittensor chain), CoinGecko, RunPod GraphQL
- **State**: TanStack Query (server), React hooks (client)
- **Charts**: Recharts

---

## Quick start (local development)

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/) 1.0+
- A [RunPod API key](https://www.runpod.io/console/settings/api-tasks) (free)
- A [Neon](https://neon.tech) Postgres database (free tier) — or a local Postgres instance

### Setup

```bash
# 1. Install dependencies
bun install

# 2. Configure environment variables
cp .env.example .env
# Edit .env and fill in:
#   DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
#   RUNPOD_API_KEY=rpa_your_key_here

# 3. Generate Prisma client + push schema to database
bun run db:generate
bun run db:push

# 4. Start the dev server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (Neon or local) |
| `RUNPOD_API_KEY` | ✅ | RunPod API key for live GPU pricing (server-side only) |

> **Security**: Never prefix these with `NEXT_PUBLIC_` — they must stay server-side. The `.env` file is gitignored.

---

## Deployment (Vercel + Neon)

This app is configured for zero-config deployment on Vercel with a Neon Postgres database.

### Step 1 — Register a domain

Register `infranexbt.app` or `infranexbt.com` at:
- [Cloudflare Registrar](https://dash.cloudflare.com) (at-cost pricing, free DNS)
- [Porkbun](https://porkbun.com) (cheap, free WHOIS privacy)

### Step 2 — Create a Neon database

1. Go to [neon.tech](https://neon.tech) → sign up (free)
2. Create a new project → name it `infranex-bt`
3. Copy the **connection string** (looks like `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`)

### Step 3 — Push to GitHub

The app is already on GitHub at [krank21r/infranex-bt](https://github.com/krank21r/infranex-bt) on the `nextjs-platform` branch. To deploy from `main`, create a pull request and merge it.

### Step 4 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → sign in with GitHub
2. **Add New** → **Project** → import `krank21r/infranex-bt`
3. Configure:
   - **Branch**: `main` (or `nextjs-platform`)
   - **Framework Preset**: Next.js (auto-detected)
   - **Build Command**: `bun run db:generate && next build` (from vercel.json)
   - **Install Command**: `bun install` (from vercel.json)
4. **Environment Variables** — add:
   - `DATABASE_URL` → your Neon connection string
   - `RUNPOD_API_KEY` → `rpa_your_key_here`
5. **Deploy** — Vercel builds and deploys automatically

### Step 5 — Add your custom domain

1. In Vercel: **Settings** → **Domains** → add `infranexbt.app`
2. Vercel shows you the DNS records to add (an `A` record and `CNAME`)
3. At your registrar/DNS provider, add:
   - `A` record: `@` → `76.76.21.21`
   - `CNAME` record: `www` → `cname.vercel-dns.com`
4. Wait 5–30 minutes for DNS propagation → Vercel provisions SSL automatically

### Step 6 — Verify

- Visit `https://infranexbt.app` — you should see the dashboard
- Check the **System & Errors** page — all 4 health checks should pass (chain, price, API, GPU)

### Vercel configuration

The `vercel.json` file configures:
- **Build command**: runs `db:generate` before `next build` so the Prisma client matches the schema
- **Function timeouts**: 60s for chain reads (`/api/network`, `/api/deployments/[id]/tick`), 30s for other API routes (Vercel Pro required for >10s; free tier caps at 10s)

> **Note on timeouts**: The Bittensor chain read takes ~5s on a cold cache, then is cached for 30s. On Vercel's **free tier** (10s timeout), the first cold read may time out — the client retries automatically on the next 30s poll. For reliable cold reads, upgrade to **Vercel Pro** ($20/mo) which allows 60s timeouts.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (client)                                             │
│  - React 19 + TanStack Query (30s/60s polling)             │
│  - 8 views with client-side navigation                      │
└──────────────────┬──────────────────────────────────────────┘
                   │ /api/network, /api/gpu-offers, /api/deployments
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ Next.js 16 API routes (Vercel serverless functions)         │
│  - /api/network   → chain + price aggregator (30s cache)    │
│  - /api/gpu-offers → RunPod GraphQL (60s cache)             │
│  - /api/deployments → Prisma CRUD + state machine           │
└──────┬───────────────┬───────────────┬──────────────────────┘
       │               │               │
       ▼               ▼               ▼
┌────────────┐  ┌────────────┐  ┌──────────────┐
│ Bittensor  │  │ CoinGecko  │  │ RunPod       │
│ Finney RPC │  │ Price API  │  │ GraphQL API  │
│ (HTTP)     │  │            │  │              │
└────────────┘  └────────────┘  └──────────────┘

       ┌───────────────────────┐
       │ Neon Postgres         │
       │ (Deployment model)    │
       └───────────────────────┘
```

### Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── network/route.ts          # Chain + price snapshot
│   │   ├── gpu-offers/route.ts       # RunPod live GPU offers
│   │   └── deployments/              # Deployment engine API
│   ├── layout.tsx                    # Root layout (fonts, providers)
│   └── page.tsx                      # Main page (view orchestration)
├── components/
│   ├── views/                        # 8 view components
│   ├── deployments/                  # Create deployment dialog
│   ├── cards/                        # Metric, subnet, opportunity cards
│   ├── tables/                       # Opportunity table
│   ├── charts/                       # Revenue chart, emission donut
│   └── layout/                       # Sidebar, header, footer
└── lib/
    ├── infranex/
    │   ├── types.ts                  # Domain types
    │   ├── data.ts                   # Curated subnet/opportunity data
    │   ├── chain.ts                  # Bittensor chain client + cache
    │   ├── runpod.ts                 # RunPod GraphQL client + cache
    │   ├── deployment/               # Deployment engine
    │   │   ├── config.ts             # Config builder
    │   │   ├── state-machine.ts      # 11-state machine
    │   │   ├── engine.ts             # Lifecycle orchestrator
    │   │   └── providers/            # Mock + RunPod adapters
    │   ├── use-network.ts            # React Query hook (chain)
    │   ├── use-gpu-offers.ts         # React Query hook (GPU)
    │   ├── use-deployments.ts        # React Query hook (deployments)
    │   ├── use-health-checks.ts      # System health probes
    │   └── use-error-log.ts          # Client error capture
    ├── db.ts                         # Prisma client singleton
    └── utils.ts                      # Formatting utilities
prisma/
└── schema.prisma                     # Deployment model (PostgreSQL)
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server (port 3000) |
| `bun run build` | Production build (standalone) |
| `bun run lint` | ESLint check |
| `bun run db:push` | Push schema to database |
| `bun run db:generate` | Regenerate Prisma client |
| `bun run db:migrate` | Create a migration |

---

## Security

- **RunPod API key** is stored in `.env` (gitignored) and only accessed server-side in API routes — never exposed to the browser
- **`.env.example`** is committed as a template; `.env` is never committed
- **CORS**: API routes only accept same-origin requests (Vercel handles this)
- **No authentication** is implemented yet — the app is open. For a 10-user restricted deployment, either:
  - Add [NextAuth.js](https://next-auth.js.org) (already available as a dependency) with GitHub/Google OAuth, or
  - Use Vercel's built-in [Password Protection](https://vercel.com/docs/security/deployment-protection) (Pro plan) to gate the entire site with a single password

---

## Live data notes

- **Chain reads** take ~5s cold, ~13ms cached (30s TTL). The server caches in-memory; on Vercel serverless, each cold function invocation re-fetches (no shared memory between instances).
- **RunPod reads** take ~1s cold, ~10ms cached (60s TTL).
- **Graceful degradation**: if the chain or RunPod is unreachable, the app falls back to curated snapshot values and shows an "Offline" banner in the System & Errors page.

---

## License

Private. All rights reserved.
