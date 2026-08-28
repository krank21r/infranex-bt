-- ============================================
-- INFRANEX BT - Phase 1B Schema Extensions
-- Approval, Audit, Automation, Drift, Change Tracking
-- ============================================
--
-- Builds on 001_initial_schema.sql. Reuses the `update_updated_at_column()`
-- trigger function defined there. Does NOT drop or modify any existing table.
--
-- Architecture reference: memory/project-architecture-spec.md
-- Three pillars this migration protects:
--   1. 3-level approval system (L1_auto / L2_confirm / L3_mandatory)
--   2. Audit log (what changed, why, by whom)
--   3. Drift detection (desired vs actual state)
--
-- ============================================

-- ============================================
-- APPROVAL REQUESTS
-- Every L2 / L3 action enters as a row before execution.
-- L1 actions may also be logged here for traceability but
-- are auto-approved at insert time.
-- ============================================
CREATE TABLE public.approval_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action_type TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('L1_auto', 'L2_confirm', 'L3_mandatory')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'auto_approved', 'failed', 'cancelled')),
    requested_by TEXT NOT NULL,
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    subject_type TEXT,
    subject_id UUID,
    payload JSONB DEFAULT '{}' NOT NULL,
    reason TEXT,
    risk_score FLOAT,
    expires_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approval_status_level_created
    ON public.approval_requests(status, level, created_at DESC);
CREATE INDEX idx_approval_subject
    ON public.approval_requests(subject_type, subject_id);
CREATE INDEX idx_approval_action_type
    ON public.approval_requests(action_type);
CREATE INDEX idx_approval_pending
    ON public.approval_requests(created_at DESC)
    WHERE status = 'pending';

CREATE TRIGGER update_approval_requests_updated_at
    BEFORE UPDATE ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: operators see only their own; admins see all
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators see own approval requests" ON public.approval_requests
    FOR SELECT USING (
        requested_by = auth.uid()::text
        OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.auth_id = auth.uid() AND u.role = 'admin'
        )
    );

CREATE POLICY "Operators create own approval requests" ON public.approval_requests
    FOR INSERT WITH CHECK (
        requested_by = auth.uid()::text
        OR requested_by LIKE 'system:%'
    );

CREATE POLICY "Operators update own pending requests" ON public.approval_requests
    FOR UPDATE USING (
        requested_by = auth.uid()::text
        OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.auth_id = auth.uid() AND u.role = 'admin'
        )
    );

-- ============================================
-- AUDIT LOGS
-- Append-only. Inserts only via service role.
-- Answers: what did Infranex detect, why this recommendation,
--          what did the user approve, what changed on the server.
-- ============================================
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    before JSONB,
    after JSONB,
    reason TEXT,
    correlation_id UUID,
    related_approval_id UUID REFERENCES public.approval_requests(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_target
    ON public.audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_actor
    ON public.audit_logs(actor, created_at DESC);
CREATE INDEX idx_audit_correlation
    ON public.audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_audit_action
    ON public.audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_created
    ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Read-only for operators; admin can read all
CREATE POLICY "Operators read all audit logs" ON public.audit_logs
    FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies: inserts are service-role only,
-- keeping the log tamper-evident from authenticated clients.

-- ============================================
-- AUTOMATION RULES
-- User-defined Auto-Pilot boundaries.
-- When `enabled` is true and conditions match, the
-- Decision Engine may auto-execute matching actions
-- without L2/L3 approval prompts.
-- ============================================
CREATE TABLE public.automation_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'auto_restart',
        'auto_recover_container',
        'safe_software_update',
        'auto_migrate',
        'max_daily_spend'
    )),
    enabled BOOLEAN NOT NULL DEFAULT false,
    conditions JSONB DEFAULT '{}' NOT NULL,
    scope JSONB DEFAULT '{}' NOT NULL,
    last_triggered_at TIMESTAMPTZ,
    trigger_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automation_user_enabled
    ON public.automation_rules(user_id, enabled);
CREATE INDEX idx_automation_rule_type
    ON public.automation_rules(rule_type) WHERE enabled = true;

CREATE TRIGGER update_automation_rules_updated_at
    BEFORE UPDATE ON public.automation_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own automation rules" ON public.automation_rules
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.auth_id = auth.uid() AND u.role = 'admin'
        )
    );

CREATE POLICY "Users manage own automation rules" ON public.automation_rules
    FOR ALL USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.auth_id = auth.uid() AND u.role = 'admin'
        )
    );

-- ============================================
-- DRIFT EVENTS
-- Desired state vs actual state mismatches.
-- Populated by the Drift Detection Engine.
-- Each row = one detected mismatch on one miner.
-- ============================================
CREATE TABLE public.drift_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    miner_id UUID NOT NULL REFERENCES public.miners(id) ON DELETE CASCADE,
    desired_state JSONB NOT NULL,
    actual_state JSONB NOT NULL,
    drift_fields TEXT[] NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning'
        CHECK (severity IN ('info', 'warning', 'critical')),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution_action TEXT,
    related_approval_id UUID REFERENCES public.approval_requests(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drift_miner_detected
    ON public.drift_events(miner_id, detected_at DESC);
CREATE INDEX idx_drift_severity_open
    ON public.drift_events(severity, resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_drift_unresolved
    ON public.drift_events(detected_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.drift_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read drift events" ON public.drift_events
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- SUBNET CHANGES
-- Change Detection Engine writes here whenever
-- a subnet's requirements, code, or incentives shift.
-- ============================================
CREATE TABLE public.subnet_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN (
        'requirements',
        'miner_code',
        'model',
        'version',
        'gpu_requirements',
        'incentive_curve',
        'metadata',
        'other'
    )),
    old_value JSONB,
    new_value JSONB,
    impact TEXT NOT NULL DEFAULT 'none'
        CHECK (impact IN ('none', 'low', 'medium', 'high', 'critical')),
    affected_miners UUID[] DEFAULT '{}' NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL DEFAULT 'scanner'
        CHECK (source IN ('scanner', 'github_poller', 'manual', 'admin')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subnet_changes_netuid
    ON public.subnet_changes(netuid, detected_at DESC);
CREATE INDEX idx_subnet_changes_type_impact
    ON public.subnet_changes(change_type, impact);
CREATE INDEX idx_subnet_changes_impact
    ON public.subnet_changes(impact, detected_at DESC) WHERE impact IN ('high', 'critical');

ALTER TABLE public.subnet_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read subnet changes" ON public.subnet_changes
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- SUBNET VERSIONS
-- Point-in-time snapshots of subnet requirements
-- and miner-repo metadata. Populated whenever a
-- new subnet version is discovered.
-- ============================================
CREATE TABLE public.subnet_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL,
    version TEXT,
    requirements JSONB DEFAULT '{}' NOT NULL,
    miner_repo_url TEXT,
    commit_sha TEXT,
    docker_image TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subnet_versions_netuid
    ON public.subnet_versions(netuid, recorded_at DESC);
CREATE INDEX idx_subnet_versions_netuid_version
    ON public.subnet_versions(netuid, version);

ALTER TABLE public.subnet_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read subnet versions" ON public.subnet_versions
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- MINER VERSIONS
-- Per-subnet miner software release history.
-- is_current flags the version currently recommended.
-- ============================================
CREATE TABLE public.miner_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL,
    version TEXT NOT NULL,
    repo_url TEXT,
    commit_sha TEXT,
    docker_image TEXT,
    release_notes TEXT,
    is_current BOOLEAN NOT NULL DEFAULT false,
    min_cuda_version TEXT,
    min_vram_gb FLOAT,
    min_ram_gb FLOAT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_miner_versions_netuid_version
    ON public.miner_versions(netuid, version);
CREATE INDEX idx_miner_versions_current
    ON public.miner_versions(netuid, is_current) WHERE is_current = true;
CREATE INDEX idx_miner_versions_recorded
    ON public.miner_versions(netuid, recorded_at DESC);

ALTER TABLE public.miner_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read miner versions" ON public.miner_versions
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- PROFITABILITY SNAPSHOTS
-- Time-series profitability per deployment.
-- Separate from the existing `profitability` aggregate
-- table (001). Use this for trend analysis and ROI history.
-- ============================================
CREATE TABLE public.profitability_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID NOT NULL REFERENCES public.deployments(id) ON DELETE CASCADE,
    netuid INTEGER NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    gross_revenue_tao FLOAT,
    gross_revenue_alpha JSONB DEFAULT '{}' NOT NULL,
    gross_revenue_inr FLOAT,
    gpu_cost_inr FLOAT,
    net_profit_inr FLOAT,
    roi_pct FLOAT,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profit_snap_deployment
    ON public.profitability_snapshots(deployment_id, snapshot_at DESC);
CREATE INDEX idx_profit_snap_netuid
    ON public.profitability_snapshots(netuid, snapshot_at DESC);
CREATE INDEX idx_profit_snap_period
    ON public.profitability_snapshots(period_start, period_end);

ALTER TABLE public.profitability_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read profitability snapshots" ON public.profitability_snapshots
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.approval_requests IS
    'L1/L2/L3 action queue. Insert = request. Update to status=approved/rejected = decision. Service role can write; operators see their own.';
COMMENT ON TABLE public.audit_logs IS
    'Append-only audit trail. Detected state, recommendations, approvals, server changes. Service-role insert only.';
COMMENT ON TABLE public.automation_rules IS
    'User-defined Auto-Pilot boundaries. Disabled by default; must be enabled per-rule per-user.';
COMMENT ON TABLE public.drift_events IS
    'Desired-state vs actual-state mismatches per miner. Drives L2 drift corrections.';
COMMENT ON TABLE public.subnet_changes IS
    'Change detection log. Populated when subnet requirements/code/incentives shift.';
COMMENT ON TABLE public.subnet_versions IS
    'Point-in-time subnet metadata history. One row per discovered version.';
COMMENT ON TABLE public.miner_versions IS
    'Per-subnet miner software release history. is_current flags the recommended version.';
COMMENT ON TABLE public.profitability_snapshots IS
    'Time-series profitability per deployment. ROI history and trend source for the Financial dashboard zone.';
