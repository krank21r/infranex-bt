-- ============================================
-- INFRANEX BT - Supabase Database Schema
-- Phase 1: Foundation Tables
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS
-- ============================================
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    wallet_address TEXT,
    hotkey_address TEXT,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('operator', 'admin', 'viewer')),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth_id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth_id = auth.uid());

-- ============================================
-- SUBNETS
-- ============================================
CREATE TABLE public.subnets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER UNIQUE NOT NULL,
    name TEXT,
    description TEXT,
    subnet_type TEXT,
    owner_hotkey TEXT,
    max_neurons INTEGER,
    max_allowed_validators INTEGER,
    immunity_period INTEGER,
    tempo INTEGER,
    min_difficulty BIGINT,
    max_difficulty BIGINT,
    difficulty BIGINT,
    rho INTEGER,
    kappa FLOAT,
    is_active BOOLEAN DEFAULT true,
    registration_open BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subnets_netuid ON public.subnets(netuid);
CREATE INDEX idx_subnets_active ON public.subnets(is_active);

-- ============================================
-- SUBNET METRICS (current snapshot)
-- ============================================
CREATE TABLE public.subnet_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL REFERENCES public.subnets(netuid),
    block BIGINT,
    miner_count INTEGER,
    validator_count INTEGER,
    emission FLOAT,
    total_emission FLOAT,
    average_incentive FLOAT,
    median_incentive FLOAT,
    top_incentive FLOAT,
    total_incentive FLOAT,
    total_stake FLOAT,
    average_stake FLOAT,
    trust FLOAT,
    consensus FLOAT,
    rank FLOAT,
    registration_cost FLOAT,
    neuron_utilization FLOAT,
    top_5_concentration FLOAT,
    top_10_concentration FLOAT,
    miner_turnover FLOAT,
    data_source TEXT DEFAULT 'bittensor_sdk',
    metadata JSONB DEFAULT '{}',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subnet_metrics_netuid ON public.subnet_metrics(netuid);
CREATE INDEX idx_subnet_metrics_recorded ON public.subnet_metrics(recorded_at);

-- ============================================
-- SUBNET METRICS HISTORY (time-series)
-- ============================================
CREATE TABLE public.subnet_metrics_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL REFERENCES public.subnets(netuid),
    block BIGINT,
    miner_count INTEGER,
    validator_count INTEGER,
    emission FLOAT,
    total_emission FLOAT,
    average_incentive FLOAT,
    median_incentive FLOAT,
    top_incentive FLOAT,
    total_incentive FLOAT,
    total_stake FLOAT,
    average_stake FLOAT,
    trust FLOAT,
    consensus FLOAT,
    rank FLOAT,
    registration_cost FLOAT,
    neuron_utilization FLOAT,
    data_source TEXT DEFAULT 'bittensor_sdk',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_metrics_history_netuid ON public.subnet_metrics_history(netuid);
CREATE INDEX idx_metrics_history_recorded ON public.subnet_metrics_history(recorded_at);
CREATE INDEX idx_metrics_history_netuid_time ON public.subnet_metrics_history(netuid, recorded_at DESC);

-- ============================================
-- NEURONS
-- ============================================
CREATE TABLE public.neurons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL REFERENCES public.subnets(netuid),
    uid INTEGER NOT NULL,
    hotkey TEXT NOT NULL,
    coldkey TEXT,
    stake FLOAT,
    rank FLOAT,
    trust FLOAT,
    consensus FLOAT,
    incentive FLOAT,
    emission FLOAT,
    dividends FLOAT,
    active BOOLEAN DEFAULT true,
    validator_permit BOOLEAN DEFAULT false,
    last_update BIGINT,
    data_source TEXT DEFAULT 'bittensor_sdk',
    metadata JSONB DEFAULT '{}',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(netuid, uid, hotkey)
);

CREATE INDEX idx_neurons_netuid ON public.neurons(netuid);
CREATE INDEX idx_neurons_hotkey ON public.neurons(hotkey);

-- ============================================
-- NEURON METRICS HISTORY
-- ============================================
CREATE TABLE public.neuron_metrics_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL,
    uid INTEGER NOT NULL,
    hotkey TEXT NOT NULL,
    stake FLOAT,
    rank FLOAT,
    trust FLOAT,
    consensus FLOAT,
    incentive FLOAT,
    emission FLOAT,
    dividends FLOAT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_neuron_history_netuid ON public.neuron_metrics_history(netuid, recorded_at DESC);

-- ============================================
-- EMISSIONS
-- ============================================
CREATE TABLE public.emissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL REFERENCES public.subnets(netuid),
    block BIGINT,
    emission_amount FLOAT,
    subnet_emission FLOAT,
    owner_emission FLOAT,
    miner_emission FLOAT,
    validator_emission FLOAT,
    data_source TEXT DEFAULT 'bittensor_sdk',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_emissions_netuid ON public.emissions(netuid, recorded_at DESC);

-- ============================================
-- INCENTIVES
-- ============================================
CREATE TABLE public.incentives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL,
    uid INTEGER,
    hotkey TEXT,
    incentive FLOAT,
    emission FLOAT,
    stake FLOAT,
    block BIGINT,
    data_source TEXT DEFAULT 'bittensor_sdk',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incentives_netuid ON public.incentives(netuid, recorded_at DESC);

-- ============================================
-- MARKET DATA
-- ============================================
CREATE TABLE public.market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER,
    alpha_price FLOAT,
    alpha_price_1h_change FLOAT,
    alpha_price_1d_change FLOAT,
    alpha_price_7d_change FLOAT,
    alpha_price_30d_change FLOAT,
    market_cap FLOAT,
    volume_24h FLOAT,
    volume_market_cap_ratio FLOAT,
    liquidity FLOAT,
    liquidity_change FLOAT,
    buy_activity FLOAT,
    emission_rate FLOAT,
    emission_percentage FLOAT,
    incentive_burn FLOAT,
    tao_price_usd FLOAT,
    tao_price_inr FLOAT,
    data_source TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_data_netuid ON public.market_data(netuid, recorded_at DESC);
CREATE INDEX idx_market_data_recorded ON public.market_data(recorded_at DESC);

-- ============================================
-- REPOSITORIES (subnet source code)
-- ============================================
CREATE TABLE public.repositories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL REFERENCES public.subnets(netuid),
    url TEXT NOT NULL,
    branch TEXT DEFAULT 'main',
    last_analyzed_at TIMESTAMPTZ,
    analysis_status TEXT DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'analyzing', 'completed', 'failed')),
    readme_content TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_repositories_netuid ON public.repositories(netuid);

-- ============================================
-- SUBNET REQUIREMENTS (extracted from repos)
-- ============================================
CREATE TABLE public.subnet_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL REFERENCES public.subnets(netuid),
    repository_id UUID REFERENCES public.repositories(id),
    python_version TEXT,
    cuda_version TEXT,
    pytorch_version TEXT,
    min_vram_gb FLOAT,
    recommended_gpu TEXT,
    ram_gb FLOAT,
    cpu_cores INTEGER,
    storage_gb FLOAT,
    docker_required BOOLEAN DEFAULT false,
    nvidia_runtime_required BOOLEAN DEFAULT false,
    ports INTEGER[],
    env_variables JSONB DEFAULT '{}',
    startup_command TEXT,
    miner_command TEXT,
    dependencies JSONB DEFAULT '{}',
    raw_requirements JSONB DEFAULT '{}',
    extraction_confidence FLOAT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_requirements_netuid ON public.subnet_requirements(netuid);

-- ============================================
-- GPU MODELS
-- ============================================
CREATE TABLE public.gpu_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    manufacturer TEXT DEFAULT 'NVIDIA',
    vram_gb FLOAT NOT NULL,
    cuda_cores INTEGER,
    cuda_compute_capability TEXT,
    memory_bandwidth_gbps FLOAT,
    fp16_tflops FLOAT,
    fp32_tflops FLOAT,
    tdp_watts INTEGER,
    generation TEXT,
    tier TEXT CHECK (tier IN ('consumer', 'prosumer', 'datacenter')),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- GPU PROVIDERS
-- ============================================
CREATE TABLE public.gpu_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    api_base_url TEXT,
    is_active BOOLEAN DEFAULT true,
    supports_mock BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- GPU OFFERS (dynamic pricing)
-- ============================================
CREATE TABLE public.gpu_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES public.gpu_providers(id),
    gpu_model_id UUID NOT NULL REFERENCES public.gpu_models(id),
    offer_id TEXT,
    region TEXT,
    hourly_price FLOAT NOT NULL,
    monthly_price FLOAT,
    currency TEXT DEFAULT 'USD',
    availability TEXT CHECK (availability IN ('available', 'limited', 'unavailable')),
    instance_type TEXT,
    vram_gb FLOAT,
    ram_gb FLOAT,
    storage_gb FLOAT,
    cpu_cores INTEGER,
    bandwidth_gbps FLOAT,
    min_rental_hours INTEGER DEFAULT 1,
    is_spot BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gpu_offers_provider ON public.gpu_offers(provider_id);
CREATE INDEX idx_gpu_offers_gpu ON public.gpu_offers(gpu_model_id);
CREATE INDEX idx_gpu_offers_availability ON public.gpu_offers(availability);

-- ============================================
-- OPPORTUNITY SCORES
-- ============================================
CREATE TABLE public.opportunity_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL REFERENCES public.subnets(netuid),
    score FLOAT NOT NULL CHECK (score >= 0 AND score <= 100),
    risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    confidence FLOAT CHECK (confidence >= 0 AND confidence <= 100),
    recommended_gpu_id UUID REFERENCES public.gpu_models(id),
    recommended_gpu_name TEXT,
    estimated_monthly_revenue FLOAT,
    estimated_monthly_cost FLOAT,
    estimated_monthly_profit FLOAT,
    currency TEXT DEFAULT 'INR',
    explanation TEXT,
    score_model_version TEXT NOT NULL DEFAULT 'v1.0',
    is_current BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_opportunity_netuid ON public.opportunity_scores(netuid);
CREATE INDEX idx_opportunity_current ON public.opportunity_scores(is_current) WHERE is_current = true;
CREATE INDEX idx_opportunity_score ON public.opportunity_scores(score DESC);

-- ============================================
-- SCORE COMPONENTS
-- ============================================
CREATE TABLE public.score_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_score_id UUID NOT NULL REFERENCES public.opportunity_scores(id),
    component_name TEXT NOT NULL,
    score FLOAT NOT NULL CHECK (score >= 0 AND score <= 100),
    weight FLOAT NOT NULL DEFAULT 1.0,
    explanation TEXT,
    raw_values JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_score_components_score ON public.score_components(opportunity_score_id);

-- ============================================
-- COMPATIBILITY TESTS
-- ============================================
CREATE TABLE public.compatibility_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    netuid INTEGER NOT NULL,
    gpu_model_id UUID REFERENCES public.gpu_models(id),
    provider_id UUID REFERENCES public.gpu_providers(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'passed', 'failed', 'warning')),
    overall_result TEXT CHECK (overall_result IN ('PASS', 'FAIL', 'WARNING')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    logs TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_compat_tests_netuid ON public.compatibility_tests(netuid);

-- ============================================
-- TEST RESULTS (individual steps)
-- ============================================
CREATE TABLE public.test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    compatibility_test_id UUID NOT NULL REFERENCES public.compatibility_tests(id),
    step_name TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'warning', 'skipped')),
    message TEXT,
    details JSONB DEFAULT '{}',
    duration_seconds FLOAT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_test_results_test ON public.test_results(compatibility_test_id);

-- ============================================
-- DEPLOYMENTS
-- ============================================
CREATE TABLE public.deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id),
    netuid INTEGER NOT NULL,
    subnet_name TEXT,
    gpu_model_id UUID REFERENCES public.gpu_models(id),
    gpu_name TEXT,
    provider_id UUID REFERENCES public.gpu_providers(id),
    provider_name TEXT,
    opportunity_score_id UUID REFERENCES public.opportunity_scores(id),
    compatibility_test_id UUID REFERENCES public.compatibility_tests(id),
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
        'requested', 'approved', 'provisioning', 'ready', 'configuring',
        'starting', 'running', 'failed', 'stopped', 'terminated'
    )),
    server_id UUID,
    hotkey_address TEXT,
    deployment_config JSONB DEFAULT '{}',
    estimated_monthly_cost FLOAT,
    estimated_monthly_revenue FLOAT,
    currency TEXT DEFAULT 'INR',
    approved_at TIMESTAMPTZ,
    provisioned_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    terminated_at TIMESTAMPTZ,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deployments_user ON public.deployments(user_id);
CREATE INDEX idx_deployments_status ON public.deployments(status);
CREATE INDEX idx_deployments_netuid ON public.deployments(netuid);

-- ============================================
-- SERVERS (GPU instances)
-- ============================================
CREATE TABLE public.servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES public.deployments(id),
    provider_id UUID REFERENCES public.gpu_providers(id),
    provider_instance_id TEXT,
    name TEXT,
    region TEXT,
    status TEXT CHECK (status IN ('provisioning', 'ready', 'running', 'stopped', 'terminated', 'error')),
    ip_address TEXT,
    ssh_port INTEGER,
    gpu_model TEXT,
    gpu_count INTEGER DEFAULT 1,
    vram_gb FLOAT,
    ram_gb FLOAT,
    cpu_cores INTEGER,
    storage_gb FLOAT,
    hourly_cost FLOAT,
    currency TEXT DEFAULT 'USD',
    metadata JSONB DEFAULT '{}',
    provisioned_at TIMESTAMPTZ,
    terminated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_servers_deployment ON public.servers(deployment_id);

-- ============================================
-- MINERS
-- ============================================
CREATE TABLE public.miners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES public.deployments(id),
    server_id UUID REFERENCES public.servers(id),
    netuid INTEGER NOT NULL,
    hotkey_address TEXT NOT NULL,
    coldkey_address TEXT,
    uid INTEGER,
    process_id INTEGER,
    status TEXT CHECK (status IN ('starting', 'running', 'stopped', 'error', 'unknown')),
    uptime_seconds BIGINT,
    last_health_check TIMESTAMPTZ,
    health_score FLOAT CHECK (health_score >= 0 AND health_score <= 100),
    metadata JSONB DEFAULT '{}',
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_miners_deployment ON public.miners(deployment_id);
CREATE INDEX idx_miners_netuid ON public.miners(netuid);
CREATE INDEX idx_miners_hotkey ON public.miners(hotkey_address);

-- ============================================
-- MINER HEALTH (time-series)
-- ============================================
CREATE TABLE public.miner_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    miner_id UUID NOT NULL REFERENCES public.miners(id),
    gpu_utilization FLOAT,
    gpu_temperature FLOAT,
    gpu_memory_utilization FLOAT,
    gpu_memory_used_mb FLOAT,
    gpu_power_draw FLOAT,
    cpu_usage FLOAT,
    ram_usage FLOAT,
    ram_used_mb FLOAT,
    disk_usage FLOAT,
    disk_used_gb FLOAT,
    network_rx_mbps FLOAT,
    network_tx_mbps FLOAT,
    miner_process_running BOOLEAN,
    subnet_connected BOOLEAN,
    incentive FLOAT,
    emission FLOAT,
    rank FLOAT,
    trust FLOAT,
    health_score FLOAT,
    errors TEXT[],
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_miner_health_miner ON public.miner_health(miner_id, recorded_at DESC);

-- ============================================
-- REWARDS
-- ============================================
CREATE TABLE public.rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    miner_id UUID NOT NULL REFERENCES public.miners(id),
    deployment_id UUID REFERENCES public.deployments(id),
    netuid INTEGER NOT NULL,
    hotkey_address TEXT NOT NULL,
    alpha_amount FLOAT NOT NULL,
    tao_equivalent FLOAT,
    emission FLOAT,
    incentive FLOAT,
    block BIGINT,
    reward_type TEXT CHECK (reward_type IN ('emission', 'incentive', 'dividend', 'other')),
    currency TEXT DEFAULT 'TAO',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rewards_miner ON public.rewards(miner_id, recorded_at DESC);
CREATE INDEX idx_rewards_deployment ON public.rewards(deployment_id, recorded_at DESC);
CREATE INDEX idx_rewards_netuid ON public.rewards(netuid, recorded_at DESC);

-- ============================================
-- EXPENSES
-- ============================================
CREATE TABLE public.expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES public.deployments(id),
    server_id UUID REFERENCES public.servers(id),
    expense_type TEXT NOT NULL CHECK (expense_type IN ('gpu_rental', 'storage', 'bandwidth', 'registration', 'burn', 'other')),
    amount FLOAT NOT NULL,
    currency TEXT DEFAULT 'USD',
    description TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_deployment ON public.expenses(deployment_id, recorded_at DESC);

-- ============================================
-- PROFITABILITY
-- ============================================
CREATE TABLE public.profitability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES public.deployments(id),
    miner_id UUID REFERENCES public.miners(id),
    netuid INTEGER NOT NULL,
    period TEXT NOT NULL CHECK (period IN ('hourly', 'daily', 'weekly', 'monthly')),
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    total_revenue FLOAT DEFAULT 0,
    total_expenses FLOAT DEFAULT 0,
    gross_profit FLOAT DEFAULT 0,
    net_profit FLOAT DEFAULT 0,
    roi FLOAT,
    alpha_earned FLOAT DEFAULT 0,
    tao_equivalent FLOAT DEFAULT 0,
    gpu_cost FLOAT DEFAULT 0,
    storage_cost FLOAT DEFAULT 0,
    bandwidth_cost FLOAT DEFAULT 0,
    other_cost FLOAT DEFAULT 0,
    currency TEXT DEFAULT 'INR',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profitability_deployment ON public.profitability(deployment_id, period, period_start DESC);

-- ============================================
-- PREDICTIONS
-- ============================================
CREATE TABLE public.predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES public.deployments(id),
    netuid INTEGER NOT NULL,
    prediction_type TEXT NOT NULL CHECK (prediction_type IN ('revenue', 'profit', 'gpu_performance', 'uptime', 'competition', 'stability')),
    predicted_value FLOAT NOT NULL,
    confidence FLOAT,
    currency TEXT DEFAULT 'INR',
    score_model_version TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_predictions_deployment ON public.predictions(deployment_id);

-- ============================================
-- ACTUAL RESULTS
-- ============================================
CREATE TABLE public.actual_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prediction_id UUID REFERENCES public.predictions(id),
    deployment_id UUID REFERENCES public.deployments(id),
    netuid INTEGER NOT NULL,
    result_type TEXT NOT NULL,
    actual_value FLOAT NOT NULL,
    currency TEXT DEFAULT 'INR',
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_actual_results_prediction ON public.actual_results(prediction_id);
CREATE INDEX idx_actual_results_deployment ON public.actual_results(deployment_id);

-- ============================================
-- PREDICTION ACCURACY
-- ============================================
CREATE TABLE public.prediction_accuracy (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES public.deployments(id),
    netuid INTEGER,
    prediction_type TEXT NOT NULL,
    predicted_value FLOAT NOT NULL,
    actual_value FLOAT NOT NULL,
    error_percentage FLOAT NOT NULL,
    absolute_error FLOAT NOT NULL,
    score_model_version TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pred_accuracy_deployment ON public.prediction_accuracy(deployment_id);

-- ============================================
-- SYSTEM LOGS
-- ============================================
CREATE TABLE public.system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warning', 'error', 'critical')),
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    job_id TEXT,
    worker TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_logs_level ON public.system_logs(level, created_at DESC);
CREATE INDEX idx_system_logs_source ON public.system_logs(source, created_at DESC);
CREATE INDEX idx_system_logs_created ON public.system_logs(created_at DESC);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subnets_updated_at BEFORE UPDATE ON public.subnets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_repositories_updated_at BEFORE UPDATE ON public.repositories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subnet_requirements_updated_at BEFORE UPDATE ON public.subnet_requirements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gpu_models_updated_at BEFORE UPDATE ON public.gpu_models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gpu_providers_updated_at BEFORE UPDATE ON public.gpu_providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deployments_updated_at BEFORE UPDATE ON public.deployments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_servers_updated_at BEFORE UPDATE ON public.servers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_miners_updated_at BEFORE UPDATE ON public.miners
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DATA: GPU Models
-- ============================================
INSERT INTO public.gpu_models (name, manufacturer, vram_gb, cuda_cores, cuda_compute_capability, memory_bandwidth_gbps, fp16_tflops, fp32_tflops, tdp_watts, generation, tier) VALUES
('RTX 3090', 'NVIDIA', 24, 10490, '8.6', 936.2, 35.6, 17.8, 350, 'Ampere', 'consumer'),
('RTX 4090', 'NVIDIA', 24, 16384, '8.9', 1008, 82.6, 41.3, 450, 'Ada Lovelace', 'consumer'),
('RTX 5090', 'NVIDIA', 32, 21760, '10.0', 1792, 104.8, 52.4, 575, 'Blackwell', 'consumer'),
('L40S', 'NVIDIA', 48, 18176, '8.9', 864, 119.5, 59.8, 350, 'Ada Lovelace', 'datacenter'),
('A100', 'NVIDIA', 80, 6912, '8.0', 2039, 77.9, 19.5, 400, 'Ampere', 'datacenter'),
('H100', 'NVIDIA', 80, 16896, '9.0', 3350, 1979.0, 51.2, 700, 'Hopper', 'datacenter'),
('H200', 'NVIDIA', 141, 16896, '9.0', 4800, 1979.0, 51.2, 700, 'Hopper', 'datacenter');

-- ============================================
-- SEED DATA: GPU Providers
-- ============================================
INSERT INTO public.gpu_providers (name, slug, api_base_url) VALUES
('RunPod', 'runpod', 'https://api.runpod.io'),
('Vast.ai', 'vastai', 'https://vast.ai/api/v2'),
('TensorDock', 'tensordock', 'https://api.tensordock.com'),
('E2E Networks', 'e2e', 'https://api.e2enetworks.com'),
('Yotta', 'yotta', 'https://api.yotta.com');
