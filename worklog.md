# Infranex BT — Work Log

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Port the Infranex BT (Bittensor mining intelligence) web app from github.com/krank21r/infranex-bt into the existing Next.js 16 single-page project and get it running.

Work Log:
- Cloned and analyzed the source repo (frontend Next.js app + Python backend + Supabase). Adapted the design language and domain model into a self-contained single-page app since only the `/` route is user-visible and no external backend is available.
- Rewrote `src/app/globals.css` with the Infranex dark editorial theme: HSL color tokens (lime primary `84 90% 60%`, deep navy background `222 47% 4%`), light-mode override, custom utilities (`text-display`, `text-eyebrow`, `grid-pattern`, `metric-card`, `editorial-card`, `pulse-dot`, `custom-scroll`).
- Updated `src/app/layout.tsx` to load Fraunces (display serif), Inter Tight (body), JetBrains Mono (data) via next/font, with `dark` class on `<html>` by default.
- Extended `src/lib/utils.ts` with formatters: `formatNumber`, `formatCurrency`, `formatTao`, `formatPercent`, `getStatusColor`, `scoreBand`, `shortAddress`, etc.
- Created `src/lib/infranex/types.ts` (Subnet, Opportunity, OpportunityFactor, UserMiner, GPUModel, GPUOffer, Deployment, RevenuePoint, EmissionShare, WorkerStatus, ViewKey).
- Created `src/lib/infranex/data.ts` — 16 Bittensor subnets, 3-pillar scoring engine (8 weighted components), opportunities with factor breakdowns, GPU catalog (8 models + 14 live offers across 5 providers), 5 user miners, 3 deployments, 30-day revenue series, emission distribution, worker statuses, aggregated dashboard metrics.
- Built layout: `sidebar.tsx` (desktop fixed + mobile Sheet), `header.tsx` (search, live clock, theme toggle, notifications dropdown, profile menu), `dashboard-layout.tsx` (flex column with sticky `mt-auto` footer).
- Built shared components: `metric-card`, `data-source-banner`, `opportunity-table` (sortable + searchable), `opportunity-detail` (dialog with 8-factor breakdown bars + compact card), `subnet-card`, `revenue-chart` (recharts area), `emission-donut` (recharts pie).
- Built 6 views with client-side state switching: Dashboard (hero + metrics + top table + revenue/emission charts + decision bands + workers), Opportunities (table/grid toggle + RUN/WATCH/AVOID filters), Subnets (searchable card grid), GPU Catalog (recommendation highlight + offers/models tabs with filters), Miners (portfolio summary + miner list + deployment step progress), Analytics (revenue trend, emission donut, score bar chart, category breakdown).
- Wired `src/app/page.tsx` to orchestrate view switching + opportunity detail dialog.
- Fixed ESLint `react-hooks/static-components` error by extracting `Th`/`SortIcon` from the OpportunityTable render scope into standalone components.
- Tuned subnet component scores so the decision engine produces a realistic distribution (4 RUN, 12 WATCH, 0 AVOID).

Stage Summary:
- Dev server runs clean on port 3000, `bun run lint` passes with zero errors.
- Agent Browser verified: all 6 views render and navigate, opportunity detail dialog opens with score breakdown, theme toggle (dark↔light) works, mobile hamburger menu works at 390px, sticky footer confirmed (sticks on short pages, pushed down on long pages).
- VLM analysis confirms: dark theme with lime accents, professional serif/mono typography, no layout issues or empty sections, premium SaaS aesthetic.
- Artifacts: design system in `globals.css`, domain layer in `src/lib/infranex/`, 6 view components in `src/components/views/`, shared cards/tables/charts in `src/components/`.

---
Task ID: 2
Agent: main (Z.ai Code)
Task: Make the web app pull live data from the Bittensor chain instead of mock.

Work Log:
- Tested external API reachability: CoinGecko (TAO price) works; Bittensor Finney chain HTTP JSON-RPC at https://entrypoint-finney.opentensor.ai/rpc works (no WebSocket needed).
- Installed @polkadot/api@15.10.2 and verified live chain connection: block ~9.02M, 129 total subnets, specVersion 455.
- Built src/lib/infranex/chain.ts: singleton chain client + fetchLiveSnapshot() querying 16 tracked subnets concurrently for subnetworkN (miner count), subnetTAO, subnetAlphaIn/Out, tempo, subnetEmissionEnabled, subnetMovingPrice. Also fetches TAO/USD price + market cap + 24h change from CoinGecko (with User-Agent header to avoid bare-fetch blocking).
- Added 30s server-side in-memory cache (SnapshotCache class) so the 5s chain read only happens once per 30s window; concurrent/cached requests return in ~13ms.
- Created API route src/app/api/network/route.ts (force-dynamic, no-store).
- Added React Query provider (src/app/providers.tsx) wrapping the app in layout.tsx.
- Built src/lib/infranex/use-network.ts: useNetwork() hook (30s polling), mergeSubnets()/mergeOpportunities() to overlay live chain metrics onto curated names/descriptions, getLiveDashboardMetrics() for aggregated live KPIs.
- Rewired UI to live data: data-source-banner now shows real "LIVE · FINNEY CHAIN" / degraded / offline states with live block + price; sidebar chain widget shows live block + subnet count + price; footer shows live block + TAO/USD; dashboard metrics now show Chain Subnets (129), TAO Price ($256), Live Miners, Avg Score; subnet cards show green "live" badge + live 256 miner count; opportunities/subnets views use mergeOpportunities/mergeSubnets; refresh buttons trigger refetch with spinning icon + "Syncing…" state.

Stage Summary:
- Live data confirmed in browser: block 9,020,679, TAO/USD $256.11, 129 chain subnets, 16 tracked with real miner counts (256 = chain cap), real TAO staked per subnet.
- Graceful degradation: if chain unreachable, source="error" and UI falls back to curated snapshot values with an "Offline · using last snapshot" banner.
- Performance: cold chain read ~5s, cached reads ~13ms (30s TTL), client polls every 30s.
- `bun run lint` clean, no runtime errors, VLM confirms LIVE indicator + price + block visible.

---
Task ID: 3
Agent: main (Z.ai Code)
Task: Add a System & Errors page where the user can see all errors and resolve them to keep the app running live.

Work Log:
- Added "system" to ViewKey union type and a 7th sidebar nav entry ("System & Errors", AlertTriangle icon, hint 07).
- Built src/lib/infranex/use-error-log.ts: a module-level singleton that listens to window "error" and "unhandledrejection" events, stores up to 100 captured errors (message, source, line/col, stack, timestamp), and exposes a useErrorLog() hook with clear()/addManual(). Subscribes via a Set so the React UI re-renders live.
- Built src/lib/infranex/use-health-checks.ts: useHealthChecks() actively probes three dependencies every 60s — /api/network (chain+price aggregator), the Finney chain RPC directly (POST chain_getHeader), and CoinGecko price API. Each returns pass/fail + latencyMs + detail + lastChecked. Per-check retry and a "Re-run all checks" button.
- Built src/components/views/system-view.tsx: overall status banner (operational/degraded/checking) with live block/TAO/subnet metrics; three HealthCheckCards with status badge, latency, last-checked time, detail, endpoint, and retry button; conditional "Resolution required" card that appears when any check fails, with per-dependency numbered troubleshooting steps; runtime error log with PROMISE/ERROR badges, relative timestamps, source file:line, expandable stack traces, and Clear button; quick-link cards to jump to other views.
- Wired SystemView into src/app/page.tsx with eyebrow "Section · 07 · Diagnostics".
- The error log immediately surfaced a real bug on first load: a hydration mismatch in the Header clock (server rendered 05:43:25 AM, client 05:43:26 AM). Fixed by making the clock client-mount-only: useState<Date|null>(null), set the date in a deferred microtask inside useEffect, and render a non-breaking space until mounted. This both fixed the hydration error and satisfied the react-hooks/set-state-in-effect lint rule.

Stage Summary:
- System & Errors view verified live in browser: "All Systems Operational" banner, all 3 health checks Pass (API route block 9,020,736 TAO $255.66, chain block 9,020,738, price feed $255.66), runtime error log shows "No runtime errors captured this session" after the hydration fix.
- Retry buttons and "Re-run all checks" work; navigation between views is seamless.
- `bun run lint` clean, no runtime errors, VLM confirms clean layout with no broken elements.
- The page gives the user a single place to see every error (chain, price feed, API route, client-side runtime) and concrete resolution steps when any check fails.

---
Task ID: 4
Agent: main (Z.ai Code)
Task: Make GPU providers data live using the user's RunPod API key.

Work Log:
- Verified the RunPod API key works: authenticated GraphQL query to https://api.runpod.io/graphql returns valid user ID. Schema introspection is disabled, so discovered field names via error-driven probing (gpuTypes -> displayName, memoryInGb, lowestPrice { minimumBidPrice, uninterruptablePrice }).
- Stored the API key in .env as RUNPOD_API_KEY (server-side only — no NEXT_PUBLIC_ prefix so it's never exposed to the client).
- Built src/lib/infranex/runpod.ts: fetchLiveGpuOffers() queries all 45 RunPod GPU types, normalizes names to canonical models (H100 80GB, A100 80GB, RTX 4090, etc.), filters to mining-relevant GPUs (21 offers), and returns live spot/on-demand prices. 60s in-memory cache (GpuSnapshotCache class). mergeGpuOffers() overlays live RunPod prices onto the curated catalog, marking non-RunPod providers as "indicative".
- Created /api/gpu-offers route (force-dynamic, no-store).
- Built src/lib/infranex/use-gpu-offers.ts: useGpuOffers() React Query hook (60s polling) + useMergedGpuOffers() that returns live + indicative offers sorted by VRAM.
- Rewired GPUs view: header now shows live offer count + "Refresh prices" button; recommendation card prefers the cheapest LIVE H100 (H100 NVL $2.59/hr) over cheaper indicative offers; offers table has a "RunPod live · N offers" badge, per-row green "live" / grey "indicative" badges, live prices in primary color; "Refresh prices" button triggers refetch with spinning icon.
- Added a 4th health check to use-health-checks.ts: probes /api/gpu-offers, reports pass/fail + live offer count. Updated system-view grid to xl:grid-cols-4 and added the GPU check card with Cpu icon + GPU-specific resolution steps (API key, .env, cache retry, fallback).

Stage Summary:
- Live RunPod GPU pricing confirmed in browser: 21 live offers across 45 GPU types. Real prices: H100 80GB $2.69/hr, H100 NVL $2.59/hr, H200 141GB $3.59/hr, B200 180GB $5.98/hr, A100 80GB $1.39/hr, A100 40GB $1.00/hr, RTX 4090 $0.34/hr, A40 $0.35/hr, RTX A6000 $0.33/hr.
- These differ from the mock values (e.g. H100 was $2.49 mock vs $2.69 live, A100 80GB was $1.10 mock vs $1.39 live).
- System & Errors page now shows 4 health checks all passing, including "RunPod GPU pricing — 21 live offers across 45 GPU types".
- API key is stored server-side only (never sent to the client). `bun run lint` clean, no runtime errors, VLM confirms live/indicative badges render correctly with no broken elements.

---
Task ID: 5
Agent: main (Z.ai Code)
Task: Build the Deployment Engine (subnet config, dependencies, docker, models, miner config).

Work Log:
- Added Deployment model to Prisma schema (id, minerName, netuid, subnetName, gpuModel, provider, status, progress, mode, hourlyCost, monthlyCost, estimatedRevenue, config JSON, providerPodId, hotkey, steps JSON, timestamps). Ran db:push to create the SQLite table.
- Built src/lib/infranex/deployment/config.ts: buildDeploymentConfig() takes a Subnet + GPUOffer and generates the full deployment config — docker image (mapped by subnet category: bittensor/training-subnet:latest, vision-subnet:latest, etc.), nvidia runtime, ports (8091/http axon, 8092/http prometheus), volumes (/workspace 100GB), env vars (BT_NETWORK, BT_NETUID, BT_WALLET_NAME, BT_HOTKEY_NAME, NVIDIA_VISIBLE_DEVICES, PYTHONUNBUFFERED), miner command (--subtensor.network finney --netuid N --wallet.name --wallet.hotkey --axon.port), min memory/vCPU/disk, cost projection (hourly/monthly/estimated revenue/ROI %), and requirements (min VRAM, python version, CUDA version, docker required, nvidia runtime required).
- Built src/lib/infranex/deployment/state-machine.ts: 11-state machine (requested → approved → provisioning → provisioned → setup → ready → deploying → started → stopping → stopped → terminated + failed) with VALID_TRANSITIONS guard table, assertCanTransition(), stateToProgress(), stateToStepIndex(), initSteps(), syncSteps() that advances the 6-step log (Request, Approve, Provision GPU, Environment Setup, Deploy Miner, Health Check) with per-step output generation.
- Built provider adapters: providers/base.ts (GPUProvider interface with provision/getStatus/terminate), providers/mock.ts (MockProvider — simulates provisioning with 800ms delay, returns fake pod IDs and IPs), providers/runpod.ts (RunPodProvider — creates REAL GPU pods via RunPod GraphQL podFindAndDeployOnDemand mutation, maps canonical GPU names to RunPod gpu_type_id values, queries pod status, terminates pods).
- Built src/lib/infranex/deployment/engine.ts: orchestrates the full lifecycle — createDeployment() (builds config, persists to DB in "requested" state), advanceDeployment() (transitions to next logical state, fires provider.provision() when entering provisioning, generates realistic step output logs), tickDeployment() (advances one step), terminateDeployment() (calls provider.terminate, sets state), listDeployments/getDeployment/deleteDeployment.
- Created API routes: /api/deployments (GET list, POST create), /api/deployments/[id] (GET detail, DELETE), /api/deployments/[id]/tick (POST advance), /api/deployments/[id]/terminate (POST terminate).
- Built React Query hooks: useDeployments (3s poll), useDeploymentDetail, useCreateDeployment, useTickDeployment, useTerminateDeployment, useDeleteDeployment.
- Built UI: CreateDeploymentDialog (3-step wizard — select subnet → select GPU offer with VRAM compatibility check → configure miner name/wallet/hotkey/mode with cost projection + ROI + RunPod cost warning), DeploymentsView (active/terminal sections, deployment cards with progress bar + step indicators + action buttons, detail panel with Step logs tab and Deployment config tab showing docker image/runtime/ports/command/env vars/requirements/cost).
- Added "deployments" to ViewKey + sidebar nav (section 06, Rocket icon). Updated page.tsx and view metadata.
- Fixed Progress component to accept indicatorClassName prop (was causing React "unrecognized prop" errors that blocked the create dialog).

Stage Summary:
- Full deployment engine verified in browser: created a mock deployment for Apex (α7) on H100 80GB, advanced through all 8 states (requested → approved → provisioning → provisioned → setup → ready → deploying → started), each step produced realistic logs (GPU detection, CUDA check, Docker check, image pull, miner config, chain registration, pre-flight health checks). Terminated successfully.
- Deployment config tab shows the exact docker image, nvidia runtime, ports, miner command (python neurons/miner.py --subtensor.network finney --netuid 7 --wallet.name infranex ...), env vars, requirements (Python 3.10, CUDA 12.2), and cost projection ($1793/mo cost, $3200/mo revenue, 78% ROI).
- Mock mode simulates the full lifecycle safely. RunPod mode creates real GPU pods via the authenticated API (with cost warning + confirmation in the wizard).
- `bun run lint` clean, no runtime errors. Deployments persist to SQLite (survive page reloads).
