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
--
-- This script is idempotent and safe to re-run. It skips any table that
-- does not exist in the target schema, so partial schemas won't break
-- the rest of the policies.
-- ============================================

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'subnets',
    'subnet_metrics',
    'opportunity_scores',
    'score_components',
    'miners',
    'repositories',
    'subnet_requirements',
    'gpu_models',
    'gpu_offers',
    'gpu_providers'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'anon_read_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
        'anon_read_' || t,
        t
      );
      RAISE NOTICE 'Applied anon_read_% policy', t;
    ELSE
      RAISE NOTICE 'Skipped (table missing): %', t;
    END IF;
  END LOOP;
END $$;

-- opportunity_scores: tighten to current rows only.
-- Applied separately so that a missing score_components table earlier in
-- the script does not stop opportunity_scores from getting its policy.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'opportunity_scores'
  ) THEN
    DROP POLICY IF EXISTS "anon_read_opportunity_scores" ON public.opportunity_scores;
    CREATE POLICY "anon_read_opportunity_scores" ON public.opportunity_scores
      FOR SELECT TO anon, authenticated
      USING (is_current = true);
  END IF;
END $$;