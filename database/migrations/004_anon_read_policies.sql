-- ============================================
-- ANON READ POLICIES FOR FRONTEND DIRECT QUERIES
-- ============================================
-- The Infranex BT frontend reads public market data directly from Supabase
-- to bypass the backend. These policies expose ONLY non-sensitive columns
-- and ONLY for read traffic. Sensitive tables (users, deployments,
-- approvals, profitability, servers) keep their existing per-user policies.
--
-- Run this in Supabase SQL editor, or via `supabase db push` after placing
-- the file in supabase/migrations/.
--
-- All write operations still require a valid JWT — anon key is read-only.
-- ============================================

-- SUBNETS — public metadata
ALTER TABLE public.subnets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_subnets" ON public.subnets;
CREATE POLICY "anon_read_subnets" ON public.subnets
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- SUBNET METRICS — public time-series (latest snapshot only via API filter)
ALTER TABLE public.subnet_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_subnet_metrics" ON public.subnet_metrics;
CREATE POLICY "anon_read_subnet_metrics" ON public.subnet_metrics
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- OPPORTUNITY SCORES — public scoring output (current snapshot only via filter)
ALTER TABLE public.opportunity_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_opportunity_scores" ON public.opportunity_scores;
CREATE POLICY "anon_read_opportunity_scores" ON public.opportunity_scores
  FOR SELECT
  TO anon, authenticated
  USING (is_current = true);

-- SCORE COMPONENTS — public breakdown for current scores
ALTER TABLE public.score_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_score_components" ON public.score_components;
CREATE POLICY "anon_read_score_components" ON public.score_components
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- MINERS — public miner telemetry (hotkey/coldkey exposed, no PII)
ALTER TABLE public.miners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_miners" ON public.miners;
CREATE POLICY "anon_read_miners" ON public.miners
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- REPOSITORIES — public repo metadata
ALTER TABLE public.repositories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_repositories" ON public.repositories;
CREATE POLICY "anon_read_repositories" ON public.repositories
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- SUBNET REQUIREMENTS — public requirements
ALTER TABLE public.subnet_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_subnet_requirements" ON public.subnet_requirements;
CREATE POLICY "anon_read_subnet_requirements" ON public.subnet_requirements
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- GPU MODELS / OFFERS — public market data
ALTER TABLE public.gpu_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_gpu_models" ON public.gpu_models;
CREATE POLICY "anon_read_gpu_models" ON public.gpu_models
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.gpu_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_gpu_offers" ON public.gpu_offers;
CREATE POLICY "anon_read_gpu_offers" ON public.gpu_offers
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.gpu_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_gpu_providers" ON public.gpu_providers;
CREATE POLICY "anon_read_gpu_providers" ON public.gpu_providers
  FOR SELECT TO anon, authenticated USING (true);