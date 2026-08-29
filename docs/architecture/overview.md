# Infranex BT — Architecture Overview

> Last updated: 2026-08-29 — v2.0 scoring model

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BITTENSOR NETWORK                            │
│                    (Subnets, Metagraphs, Neurons)                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        DATA INGESTION LAYER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Scanner    │  │   Market     │  │   Analyzer               │  │
│  │   Worker     │  │   Worker     │  │   Worker                 │  │
│  │ (subnets,    │  │ (TAO/BTC     │  │ (GitHub repos,           │  │
│  │  metrics,    │  │  prices,     │  │  requirements            │  │
│  │  emissions)  │  │  FX rates)   │  │  extraction)             │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                       │                 │
└─────────┼─────────────────┼───────────────────────┼─────────────────┘
          │                 │                       │
          ▼                 ▼                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         SUPABASE (PostgreSQL)                       │
│   subnets │ metrics │ emissions │ market_data │ requirements │ gpus  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       INTELLIGENCE ENGINE (v2.0)                     │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                    3-PILLAR SCORING MODEL                    │   │
│   │                                                              │   │
│   │   ┌───────────┐   ┌───────────┐   ┌───────────┐            │   │
│   │   │  UTILITY  │   │ TECHNICAL │   │ ECONOMICS │            │   │
│   │   │   (30%)   │   │   (35%)   │   │   (35%)   │            │   │
│   │   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘            │   │
│   │         │               │               │                   │   │
│   │         └───────────────┼───────────────┘                   │   │
│   │                         ▼                                   │   │
│   │              OPPORTUNITY SCORE (0-100)                      │   │
│   │                         ▼                                   │   │
│   │            RUN / WATCH / AVOID                              │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ┌──────────────────────┐   ┌──────────────────────────────────┐  │
│   │   GPU Matching       │   │   Profitability Projection       │  │
│   │   (catalog ranking)  │   │   (revenue/cost/ROI)             │  │
│   └──────────────────────┘   └──────────────────────────────────┘  │
│                                                                      │
│   ┌──────────────────────┐   ┌──────────────────────────────────┐  │
│   │   Monitoring         │   │   Should-Migrate Detection       │  │
│   │   (health/emissions) │   │   (rolling ROI threshold)        │  │
│   └──────────────────────┘   └──────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         STRATEGY ENGINE                              │
│                                                                      │
│   Opportunity Score → Portfolio Constraints → Action (RUN/WATCH/AVOID) │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │   Portfolio State: current miners, spend, exposure           │  │
│   │   Constraints: max miners, max spend, diversification        │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      MINER ORCHESTRATOR                              │
│                                                                      │
│   Action → Approval Gate → Provision → Setup → Deploy → Monitor     │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │   Lifecycle State Machine:                                     │  │
│   │   IDLE → ANALYZING → SCORING → APPROVING → PROVISIONING      │  │
│   │   → SETUP → DEPLOYING → RUNNING → MONITORING → OPTIMIZING    │  │
│   │   → RECOVERING → EXITING → TERMINATED                         │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        DEVOPS ENGINE                                 │
│                                                                      │
│   ┌─────────────┐  ┌─────────────┐  ┌────────────────────────────┐ │
│   │  Providers  │  │  Deploy     │  │  Health Checks             │ │
│   │  (RunPod,   │  │  Engine     │  │  (SSH, GPU util,           │ │
│   │  Vast.ai,   │  │  (provision │  │   subnet connectivity)     │ │
│   │  TensorDock,│  │   → setup   │  │                            │ │
│   │  E2E)       │  │   → deploy) │  │                            │ │
│   └─────────────┘  └─────────────┘  └────────────────────────────┘ │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      MONITORING & LEARNING                           │
│                                                                      │
│   ┌─────────────┐  ┌─────────────┐  ┌────────────────────────────┐ │
│   │  Real-time  │  │  Recovery   │  │  Learning Engine           │ │
│   │  Monitoring │  │  Engine     │  │  (feedback loop,           │ │
│   │  (alerts,   │  │  (restart,  │  │   weight adaptation,       │ │
│   │  SSE)       │  │  redeploy,  │  │   drift detection)         │ │
│   │             │  │  migrate)   │  │                            │ │
│   └─────────────┘  └─────────────┘  └────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
BITTENSOR NETWORK
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DISCOVERY LAYER                             │
│                                                                 │
│  Scanner → Subnets, Metrics, Neurons, Emissions, Incentives    │
│  Analyzer → GitHub repos, Requirements (VRAM, CUDA, RAM, etc.) │
│  Market Worker → TAO price, liquidity, volume                  │
│                                                                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SCORING LAYER                              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  PILLAR 1: UTILITY (30%)                                  │ │
│  │  ├── What does the subnet do?                             │ │
│  │  ├── Is it a useful service or a copycat?                 │ │
│  │  └── Data: subnet metadata, README analysis               │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  PILLAR 2: TECHNICAL (35%)                                │ │
│  │  ├── GPU requirements (VRAM, CUDA, RAM, bandwidth)        │ │
│  │  ├── Dependency complexity                                │ │
│  │  ├── % of catalog GPUs that meet requirements             │ │
│  │  └── Data: SubnetRequirement + GPUModel tables            │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  PILLAR 3: ECONOMICS (35%)                                │ │
│  │  ├── Emissions & incentives                               │ │
│  │  ├── Competition concentration                            │ │
│  │  ├── GPU cost vs expected revenue                         │ │
│  │  ├── Reward stability                                     │ │
│  │  └── Data: SubnetMetrics + MarketData tables              │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  OPPORTUNITY SCORE (0-100)                                      │
│                              │                                  │
│                              ▼                                  │
│  DECISION: RUN (≥75) / WATCH (40-74) / AVOID (<40)             │
│                                                                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                          │
│                                                                 │
│  Strategy Engine → Portfolio Constraints → Action              │
│  Miner Orchestrator → Lifecycle State Machine                  │
│  Deployment Engine → Provider APIs → GPU Servers               │
│                                                                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FEEDBACK LOOP                                │
│                                                                 │
│  Monitor → Performance Data → Learning Engine → Weights        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Inventory

| Module | Location | Purpose |
|--------|----------|---------|
| Intelligence Engine | `backend/app/intelligence/` | Scoring, GPU matching, profitability, monitoring |
| Strategy Engine | `backend/app/strategy/` | Score → Action decision layer |
| Miner Orchestrator | `backend/app/orchestrator/` | Lifecycle state machine |
| Optimizer | `backend/app/optimizer/` | Cost savings, subnet alternatives |
| Recovery | `backend/app/recovery/` | Health checks, recovery strategies |
| Learning Engine | `backend/app/learning/` | Feedback loop, weight adaptation |
| Compatibility Lab | `backend/app/compatibility/` | GPU/server requirement validation |
| Monitoring | `backend/app/monitoring/` | Real-time alerts, SSE |
| Providers | `backend/app/providers/` | GPU provider adapters |
| Deployment | `backend/app/deployment/` | Deploy lifecycle, health checks |
| Approval | `backend/app/approval/` | L1/L2/L3 approval gates |

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| Backend | FastAPI, Python 3.11+, Pydantic v2, SQLAlchemy, Alembic |
| Database | Supabase PostgreSQL (RLS, migrations, realtime) |
| Auth | Supabase Auth (JWT, OAuth) |
| Cache | Redis/Valkey |
| Workers | Python async workers, triggered by Vercel Cron |
| Containerization | Docker multi-stage builds |
| CI/CD | GitHub Actions → Vercel |
| Bittensor | Official Python SDK (bittensor>=9.0) |

---

## Phase Status

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1A | ✅ Complete | Frontend + Supabase + FastAPI foundation |
| Phase 1B | ✅ Complete | Approval + Audit + Drift schema |
| Phase 1C | ✅ Complete | 3-level approval module |
| Phase 2 | ✅ Complete | Bittensor Scanner (dual-mode client) |
| Phase 3 | ✅ Complete | Intelligence Engine (v1.0 scoring) |
| Phase 4 | ✅ Complete | Subnet Analyzer (GitHub integration) |
| Phase 5 | ✅ Complete | GPU Matching + Provider Adapters |
| Phase 6 | ✅ Complete | Profitability Engine |
| Phase 7 | ✅ Complete | Compatibility Lab |
| Phase 8 | ✅ Complete | Deployment Engine |
| Phase 9 | ✅ Complete | Monitoring & Alerts |
| Phase 10 | ✅ Complete | Learning Engine + Feedback Loop |
| **Phase 11** | 🔄 **In Progress** | **v2.0 Scoring Model (3-Pillar)** |

---

## Security Principles

| Principle | Implementation |
|-----------|----------------|
| No Coldkey Storage | Coldkeys never stored in DB, logs, env, or frontend |
| Hotkey Handling | Hotkeys provided at deployment time only, encrypted in transit |
| Approval Gates | Every deployment requires explicit user confirmation |
| Audit Logging | All actions logged with user, timestamp, decision |
| RLS | Row-level security on all user/data tables |
| No Auto-Spend | Zero automatic financial transactions |

---

## API Prefix

All API routes are prefixed with `/api` (configurable via `API_V1_PREFIX`).

Health checks: `/health`, `/health/live`, `/health/ready`

API routes: `/api/subnets`, `/api/opportunities`, `/api/deployments`, etc.
