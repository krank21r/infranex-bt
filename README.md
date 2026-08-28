# Infranex BT

**Bittensor Intelligence & Mining Operations Platform**

> A production-ready platform for discovering, analyzing, and deploying Bittensor mining operations with GPU infrastructure automation.

---

## 🎯 Overview

Infranex BT automates the complete Bittensor mining lifecycle:

```
DISCOVER → ANALYZE → SCORE → MATCH GPU → CALCULATE PROFIT → APPROVE → TEST → DEPLOY → MONITOR → MEASURE → LEARN
```

**Key Capabilities:**
- Continuous Bittensor network scanning (subnets, metagraphs, neurons, incentives)
- Subnet intelligence scoring with explainable components
- GitHub repository analysis for technical requirements extraction
- GPU compatibility matching across providers (RunPod, Vast.ai, TensorDock, E2E)
- Profitability estimation with confidence intervals
- Compatibility lab for pre-deployment validation
- Secure deployment engine with explicit approval gates
- Real-time miner monitoring and actual vs predicted profitability tracking
- Feedback loop for continuous scoring improvement

---

## 🏗 Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Bittensor Net  │────▶│  Data Ingestion  │────▶│    Supabase      │
│  (SDK/RPC)      │     │  (Scanner Worker)│     │  (PostgreSQL)    │
└─────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                          │
                    ┌──────────────────┐                  │
                    │  GitHub / Market │──────────────────┘
                    │  Data Workers    │
                    └──────────────────┘
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Deployments    │◀───│  Deployment Eng. │◀───│ Compatibility    │
│  (GPU Servers)  │     │  (Provider APIs) │     │  Lab (Docker)    │
└─────────────────┘     └──────────────────┘     └──────────────────┘
         │                       ▲
         ▼                       │
┌─────────────────┐     ┌──────────────────┐
│  Monitoring     │────▶│  Feedback/       │
│  (Health/Reward)│     │  Learning Engine │
└─────────────────┘     └──────────────────┘
```

---

## 🛠 Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| **Backend** | FastAPI, Python 3.11+, Pydantic v2, Supabase, Redis/Valkey |
| **Database** | Supabase PostgreSQL (with RLS, migrations) |
| **Auth** | Supabase Auth (JWT, OAuth) |
| **Workers** | Python async workers, invoked by Vercel Cron |
| **Containerization** | Docker multi-stage builds |
| **CI/CD** | GitHub Actions → Vercel (frontend + backend) |
| **Bittensor** | Official Python SDK (bittensor>=9.0) |

---

## 📋 Prerequisites

- **Node.js** 20+
- **Python** 3.11+
- **Docker** & Docker Compose
- **Supabase** account (project URL + keys)
- **Bittensor** testnet/mainnet RPC endpoint
- **GitHub** token (for subnet repo analysis)
- **GPU Provider** API keys (RunPod, Vast.ai, etc.) — optional for mock mode

---

## 🚀 Quick Start (Local Development)

### 1. Clone & Configure

```bash
git clone <repository-url>
cd infranex-bt

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
# Required minimum:
# - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# - BITTENSOR_RPC_ENDPOINT
# - REDIS_URL
```

### 2. Start with Docker Compose (Recommended)

```bash
# From project root
docker-compose up -d

# Services:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:8000
# - API Docs: http://localhost:8000/docs
# - PostgreSQL: localhost:5432
# - Redis: localhost:6379
```

### 3. Or Run Manually

**Backend:**
```bash
cd infranex-bt/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run migrations (requires Supabase)
psql $SUPABASE_URL -f ../database/migrations/001_initial_schema.sql

# Start API
uvicorn app.main:app --reload --port 8000

# Start worker (separate terminal)
python -m app.workers.runner
```

**Frontend:**
```bash
cd infranex-bt/frontend
npm install
npm run dev
```

---

## 🔐 Environment Variables

### Required (All Environments)

| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | `eyJ...` |
| `BITTENSOR_NETWORK` | `testnet` or `finney` | `testnet` |
| `BITTENSOR_RPC_ENDPOINT` | Subtensor RPC WebSocket | `wss://entrypoint-finney.opentensor.ai:443` |
| `REDIS_URL` | Redis/Valkey connection | `redis://localhost:6379/0` |
| `SECRET_KEY` | JWT signing secret (32+ chars) | `random-secret-key` |
| `DEPLOYMENT_MODE` | `mock` or `production` | `mock` |
| `DEFAULT_CURRENCY` | Display currency | `INR` |
| `USD_TO_INR` | USD to INR conversion rate | `83.5` |

### Frontend Specific

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client) |
| `NEXT_PUBLIC_APP_NAME` | App display name |

### Optional (Production)

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub PAT for repo analysis |
| `RUNPOD_API_KEY` | RunPod API key |
| `VASTAI_API_KEY` | Vast.ai API key |
| `TENSORDOCK_API_KEY` | TensorDock API key |
| `E2E_API_KEY` | E2E Networks API key |
| `MARKET_API_KEY` | Market data API key |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) |
| `CRON_SECRET` | Shared secret for Vercel Cron auth (`Authorization: Bearer $CRON_SECRET`). **Required in production** — cron routes refuse to run if unset. |

---

## 📦 Database Setup (Supabase)

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note: Project URL, Anon Key, Service Role Key

### 2. Run Migrations

```bash
# Option A: Via Supabase CLI (recommended)
supabase db reset --linked

# Option B: Direct SQL
psql "postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" \
  -f database/migrations/001_initial_schema.sql
```

### 3. Enable Realtime (Optional)

In Supabase Dashboard → Replication → Enable for tables:
- `subnet_metrics`
- `opportunity_scores`
- `deployments`
- `miners`
- `miner_health`

### 4. Configure Auth

- Authentication → Providers → Enable Email, GitHub OAuth
- Authentication → URL Configuration → Add redirect URLs

---

## ☁️ Deployment

### Frontend → Vercel

1. Connect GitHub repo to Vercel
2. Set Root Directory: `infranex-bt/frontend`
3. Add Environment Variables (from `.env.example` with `NEXT_PUBLIC_` prefix)
4. Deploy

**Required Vercel Secrets:**
- `VERCEL_TOKEN` (from Vercel account settings)
- `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (from `vercel inspect`)
- All `NEXT_PUBLIC_*` variables

### Backend → Vercel (Serverless)

The backend runs as a Python serverless function on Vercel. Scheduled
work (scanner, market data, scoring) runs on **Vercel Cron** which hits
authenticated endpoints under `/api/cron/*`.

1. Create a new Vercel project pointing at the repo, **Root Directory: `infranex-bt/backend`**.
2. Framework preset: **Other** (Vercel auto-detects `api/index.py` and `vercel.json`).
3. Add all backend environment variables (see table above). Set `APP_ENV=production` and `DEPLOYMENT_MODE=mock` until you are ready to spend real money.
4. Set a strong random `CRON_SECRET` and add the same value to every cron target in `backend/vercel.json` — Vercel will send it as `Authorization: Bearer $CRON_SECRET` on every scheduled call.

**Required Vercel Secrets:**
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (for CI deploys)
- All `SUPABASE_*`, `BITTENSOR_*`, `REDIS_URL`, `SECRET_KEY`, `CRON_SECRET` variables

**Vercel Cron jobs** (defined in `backend/vercel.json`):

| Path | Schedule | Worker |
|------|----------|--------|
| `/api/cron/market-data` | every hour | market data worker |
| `/api/cron/scanner` | every 5 min | subnet scanner |
| `/api/cron/scoring` | every 15 min | opportunity scoring |

> The cron routes refuse to run if `CRON_SECRET` is unset — fail loud,
> not silently public.

### Database → Supabase (Managed)

Use Supabase managed PostgreSQL — no separate deployment needed.

---

## 🧪 Development Mode

**Default: `DEPLOYMENT_MODE=mock`**

In mock mode:
- ✅ Real Bittensor read-only data (if RPC configured)
- ✅ Mock GPU providers (no real provisioning)
- ✅ Mock deployments (no real infrastructure)
- ✅ Test wallet configuration
- ❌ No real money movement
- ❌ No actual GPU rental

**To enable production:**
1. Set `DEPLOYMENT_MODE=production`
2. Configure real GPU provider API keys
3. Set up secure hotkey management
4. Review all security settings

---

## 📁 Project Structure

```
infranex-bt/
├── frontend/                 # Next.js 15 App
│   ├── app/                  # App Router pages
│   │   ├── (auth)/          # Auth pages (login, callback)
│   │   ├── dashboard/       # Dashboard page
│   │   ├── subnets/         # Subnets pages
│   │   ├── opportunities/   # Opportunities pages
│   │   └── api/             # API routes (proxy)
│   ├── components/
│   │   ├── ui/              # shadcn/ui components
│   │   ├── layout/          # Sidebar, Header, Layout
│   │   ├── cards/           # MetricCard, OpportunityCard
│   │   ├── tables/          # Data tables
│   │   └── charts/          # Recharts components
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Utilities, API client, Supabase
│   └── types/               # TypeScript interfaces
│
├── backend/                  # FastAPI App
│   ├── app/
│   │   ├── api/             # API routes
│   │   │   ├── deps.py      # Dependencies
│   │   │   └── routes/      # Route modules
│   │   ├── core/            # Config, DB, Auth, Logging
│   │   ├── schemas/         # Pydantic models
│   │   ├── services/        # Business logic
│   │   ├── workers/         # Background workers
│   │   └── integrations/    # External integrations
│   ├── tests/               # Pytest tests
│   └── requirements.txt
│
├── database/
│   └── migrations/          # Supabase SQL migrations
│
├── docker/
│   ├── Dockerfile.frontend
│   ├── Dockerfile.backend
│   └── docker-compose.yml
│
├── .github/
│   └── workflows/           # CI/CD pipelines
│
├── docs/
│   ├── architecture/
│   ├── api/
│   └── deployment/
│
├── .env.example
├── docker-compose.yml
└── README.md
```

---

## 🔧 API Reference

### Health Checks
```
GET  /health              # Full health check
GET  /health/live         # Liveness probe
GET  /health/ready        # Readiness probe
```

### Subnets
```
GET  /api/subnets                    # List subnets (paginated)
GET  /api/subnets/{netuid}           # Subnet detail
GET  /api/subnets/{netuid}/metrics   # Current metrics
GET  /api/subnets/{netuid}/history   # Historical metrics
GET  /api/subnets/{netuid}/score     # Opportunity score
```

### Opportunities
```
GET  /api/opportunities              # List opportunities
GET  /api/opportunities/{id}         # Opportunity detail
```

### GPUs & Providers
```
GET  /api/gpus                       # GPU catalog
GET  /api/gpus/{id}                  # GPU detail
GET  /api/providers                  # Provider list
GET  /api/providers/{id}/offers      # Current GPU offers
```

### Deployments
```
POST /api/deployments/preview        # Preview deployment (cost, config)
POST /api/deployments/approve        # Approve & deploy
GET  /api/deployments                # List deployments
GET  /api/deployments/{id}           # Deployment detail
```

### Miners & Monitoring
```
GET  /api/miners                     # List miners
GET  /api/miners/{id}/health         # Miner health history
```

### Rewards & Profitability
```
GET  /api/rewards                    # Reward history
GET  /api/profitability              # Profitability reports
```

### Admin
```
POST /api/admin/rescan-subnet        # Trigger subnet rescan
POST /api/scanner/run                # Run full scan
```

### Approvals (3-level capital protection)
```
GET  /api/approvals                  # List approval requests (filter by status, level, action)
GET  /api/approvals/pending          # Pending requests only (dashboard badge)
POST /api/approvals/{id}/approve     # Approve an L2/L3 request
POST /api/approvals/{id}/reject      # Reject an L2/L3 request
GET  /api/approvals/audit            # Audit log (paginated, with filters)
```

Infranex classifies every consequential action into one of three levels:

| Level | Meaning | Example actions |
|-------|---------|-----------------|
| **L1_auto** | Safe, reversible, no money. Executes immediately and is logged. | refresh metrics, fetch status, score opportunities, log drift observations |
| **L2_confirm** | Small financial impact (configurable) OR reversible operational change. Needs one human approval. | rent GPU under cap, restart miner, recover container, software update within known-good range |
| **L3_mandatory** | Capital-intensive, irreversible, or strategy-shifting. Needs explicit approval every time. | deploy new miner, migrate to new subnet, increase spend cap, sign payout |

Rules are codified in `backend/app/approval/classifier.py` and are
version-stamped. Every decision carries a `risk_score`, `reason`, and
`payload` so the user sees *why* before they approve. The audit log
(`/api/approvals/audit`) is the tamper-evident record of what Infranex
detected, recommended, and what actually changed on the server.

---

## 🧰 Development Commands

```bash
# Frontend
cd frontend
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npm run typecheck    # TypeScript check

# Backend
cd backend
uvicorn app.main:app --reload      # Dev server
pytest tests/ -v                   # Run tests
ruff check app/                    # Lint
mypy app/                          # Type check

# Database
psql $SUPABASE_URL -f database/migrations/001_initial_schema.sql

# Docker
docker-compose up -d               # Start all services
docker-compose logs -f backend     # View backend logs
docker-compose down -v             # Stop and remove volumes
```

---

## 🔒 Security Principles

| Principle | Implementation |
|-----------|----------------|
| **No Coldkey Storage** | Coldkeys never stored in DB, logs, env, or frontend |
| **Hotkey Handling** | Hotkeys provided at deployment time only, encrypted in transit |
| **Secrets Management** | All credentials via environment variables / secret managers |
| **Approval Gates** | Every deployment requires explicit user confirmation |
| **Audit Logging** | All actions logged with user, timestamp, decision |
| **RLS** | Row-level security on all user/data tables |
| **No Auto-Spend** | Zero automatic financial transactions |

---

## 🧪 Running tests

Backend tests use pytest + pytest-asyncio (both already in `requirements.txt`). They cover the L1/L2/L3 classifier decision matrix and a FastAPI smoke test that confirms the app loads and all routers are mounted.

```bash
cd backend
python -m pytest tests/ -v
```

Tests are pure-Python where possible (no database) so they run fast in CI. Database-touching integration tests against a real Postgres will be added in a later pass.

---

## 🗃️ Database migrations (Alembic)

The 27+8 tables were created with hand-written SQL in `database/migrations/001_initial_schema.sql` and `002_approval_audit_drift.sql`. From this point forward, **all new schema changes go through Alembic** (`backend/alembic/`).

**For an existing DB that already has the schema applied** (production, staging, your dev DB that ran 001+002):

```bash
cd backend
alembic stamp head   # mark the current schema as up-to-date without running anything
```

**For a brand-new dev DB**:

```bash
cd backend
# 1. Apply the original SQL files first (Alembic baseline doesn't recreate them)
psql "$DATABASE_URL" -f ../database/migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f ../database/migrations/002_approval_audit_drift.sql
# 2. Stamp so Alembic knows the schema is current
alembic stamp head
```

**For new schema changes going forward**:

```bash
# Edit app/models/*.py, then:
alembic revision --autogenerate -m "add foo table"
# Review the generated file in backend/alembic/versions/ before applying:
alembic upgrade head
```

`env.py` reads `DATABASE_URL` from your environment / `.env` (same as the rest of the app), and the 35 ORM models in `app/models/` are auto-discovered via `Base.metadata`.

---

## 📊 Phase Status

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1A** | ✅ Complete | Frontend + Supabase + FastAPI foundation, ORM models for all 27 tables |
| **Phase 1B** | ✅ Complete | Approval + Audit + Drift schema (`002_approval_audit_drift.sql`, 8 new tables) + SQLAlchemy models + Vercel Cron wiring |
| **Phase 1C** | ✅ Complete | 3-level approval module live (`backend/app/approval/`), L1/L2/L3 classifier, audit writer, approval router wired into API |
| Phase 2 | 🔄 Planned | Bittensor Scanner (SDK integration) |
| Phase 3 | 🔄 Planned | Intelligence Engine (scoring) |
| Phase 4 | 🔄 Planned | Subnet Analyzer (GitHub integration) + Change Detection engine |
| Phase 5 | 🔄 Planned | GPU Matching & Provider Engine |
| Phase 6 | 🔄 Planned | Profitability Engine |
| Phase 7 | 🔄 Planned | Compatibility Lab |
| Phase 8 | 🔄 Planned | Deployment Engine |
| Phase 9 | 🔄 Planned | Monitoring & Rewards + Drift comparator |
| Phase 10 | 🔄 Planned | Feedback & Learning Engine |

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

**Code Standards:**
- Frontend: ESLint + Prettier + TypeScript strict
- Backend: Ruff + MyPy + Pytest (coverage > 80%)
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)

---

## 📄 License

Private — Internal Operations Platform

---

## 🆘 Support

- **Issues**: GitHub Issues
- **Architecture**: `docs/architecture/`
- **API Docs**: `http://localhost:8000/docs` (local) or production `/docs`
- **Database**: Supabase Dashboard → SQL Editor

---

**Built with ⚡ for Bittensor Mining Operations**