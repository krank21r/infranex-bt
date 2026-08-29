-- ============================================
-- INFRANEX BT - Phase 10: Learning Engine
-- Performance aggregation, accuracy tracking,
-- weight adjustments, and drift alerts.
-- ============================================
--
-- Builds on 001_initial_schema.sql and 002_approval_audit_drift.sql.
-- Reuses the `update_updated_at_column()` trigger function.
-- Does NOT drop or modify any existing table.
--
-- Architecture: closed-loop scoring feedback.
--  1. Aggregate actual miner/subnet performance
--  2. Compare predicted OpportunityScore vs actual ROI
--  3. Compute model accuracy per version
--  4. Detect drift beyond threshold
--  5. Propose bounded weight adjustments (max 20% per iteration)
--  6. Support A/B weight testing with rollback
-- ============================================

-- ============================================
-- PERFORMANCE REPORTS
-- Aggregated actual performance for a deployment
-- or subnet over a trailing window.
-- ============================================
CREATE TABLE public.performance_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES public.deployments(id) ON DELETE CASCADE,
    netuid INTEGER NOT NULL,
    report_type TEXT NOT NULL DEFAULT 'miner'
        CHECK (report_type IN ('miner', 'subnet')),
    window_days INTEGER NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    total_revenue FLOAT,
    total_cost FLOAT,
    total_profit FLOAT,
    roi FLOAT,
    uptime_ratio FLOAT,
    emission_per_block_avg FLOAT,
    emission_per_block_median FLOAT,
    health_score_avg FLOAT,
    sample_size INTEGER NOT NULL DEFAULT 0,
    model_version TEXT,
    metadata JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_perf_reports_deployment
    ON public.performance_reports(deployment_id, created_at DESC);
CREATE INDEX idx_perf_reports_netuid
    ON public.performance_reports(netuid, report_type, created_at DESC);
CREATE INDEX idx_perf_reports_type_window
    ON public.performance_reports(report_type, window_days, created_at DESC);

ALTER TABLE public.performance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read performance reports"
    ON public.performance_reports FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- ACCURACY TRACKING
-- Predicted OpportunityScore vs actual ROI outcomes
-- observed after 7, 14, and 30 days.
-- ============================================
CREATE TABLE public.accuracy_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_score_id UUID REFERENCES public.opportunity_scores(id) ON DELETE CASCADE,
    deployment_id UUID REFERENCES public.deployments(id) ON DELETE SET NULL,
    netuid INTEGER NOT NULL,
    predicted_score FLOAT NOT NULL,
    actual_roi_7d FLOAT,
    actual_roi_14d FLOAT,
    actual_roi_30d FLOAT,
    actual_roi FLOAT,
    error_percentage FLOAT,
    absolute_error FLOAT,
    component_errors JSONB DEFAULT '{}' NOT NULL,
    score_model_version TEXT,
    evaluation_days INTEGER NOT NULL DEFAULT 0,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accuracy_opportunity
    ON public.accuracy_tracking(opportunity_score_id, recorded_at DESC);
CREATE INDEX idx_accuracy_deployment
    ON public.accuracy_tracking(deployment_id, recorded_at DESC);
CREATE INDEX idx_accuracy_netuid
    ON public.accuracy_tracking(netuid, recorded_at DESC);
CREATE INDEX idx_accuracy_model_version
    ON public.accuracy_tracking(score_model_version, recorded_at DESC);

ALTER TABLE public.accuracy_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read accuracy tracking"
    ON public.accuracy_tracking FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- WEIGHT ADJUSTMENTS
-- Auditable record of every proposed weight change
-- for the scoring engine. Supports A/B testing and
-- rollback by comparing model versions.
-- ============================================
CREATE TABLE public.weight_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_version TEXT NOT NULL,
    previous_weights JSONB NOT NULL,
    new_weights JSONB NOT NULL,
    adjustments JSONB NOT NULL,
    reason TEXT,
    accuracy_report_id UUID,
    applied BOOLEAN NOT NULL DEFAULT false,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weight_adj_model
    ON public.weight_adjustments(model_version, created_at DESC);
CREATE INDEX idx_weight_adj_applied
    ON public.weight_adjustments(applied, created_at DESC);

ALTER TABLE public.weight_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read weight adjustments"
    ON public.weight_adjustments FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- DRIFT ALERTS
-- Signals that model accuracy has drifted beyond
-- the configured threshold. Used by the Learning
-- Engine to trigger weight review or rollback.
-- ============================================
CREATE TABLE public.drift_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_version TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    current_value FLOAT NOT NULL,
    baseline_value FLOAT NOT NULL,
    drift_ratio FLOAT NOT NULL,
    threshold FLOAT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning'
        CHECK (severity IN ('warning', 'critical')),
    is_resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drift_alerts_model
    ON public.drift_alerts(model_version, created_at DESC);
CREATE INDEX idx_drift_alerts_unresolved
    ON public.drift_alerts(is_resolved, created_at DESC) WHERE is_resolved = false;
CREATE INDEX idx_drift_alerts_severity
    ON public.drift_alerts(severity, is_resolved, created_at DESC);

ALTER TABLE public.drift_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read drift alerts"
    ON public.drift_alerts FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.performance_reports IS
    'Aggregated actual miner/subnet performance over a trailing window.';
COMMENT ON TABLE public.accuracy_tracking IS
    'Predicted OpportunityScore vs actual ROI outcomes (7/14/30 day horizons).';
COMMENT ON TABLE public.weight_adjustments IS
    'Auditable weight-change proposals. applied=true means the new weights were validated and promoted.';
COMMENT ON TABLE public.drift_alerts IS
    'Model accuracy drift alerts. is_resolved=true means the alert was acknowledged or the model was rolled back.';
