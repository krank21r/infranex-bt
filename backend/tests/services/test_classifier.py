"""
Tests for the L1/L2/L3 action classifier.

The classifier is rule-based and version-stamped (see
`feedback-scoring-versioned-explainable.md`). It is the single chokepoint
that decides whether an action may execute immediately (L1), needs one
human approval (L2), or is capital-intensive / irreversible and must
get explicit approval every time (L3).

These tests are pure-Python (no DB) because the classifier is a pure
function. If anyone tries to add a side effect here, the tests still
pass and the side effect is silent - keep it that way.
"""

from app.approval.classifier import (
    DEFAULT_L2_AMOUNT_INR_CAP,
    DEFAULT_L3_AMOUNT_INR_CAP,
    ActionContext,
    ActionLevel,
    classify_action,
)

# --- baseline: known action_types map to known levels ------------------

class TestKnownActionTypes:
    def test_l1_actions(self):
        for action in [
            "refresh_metrics",
            "fetch_subnet_status",
            "fetch_gpu_prices",
            "log_recommendation",
            "log_drift_observation",
            "score_opportunity",
            "recompute_compatibility",
        ]:
            assert classify_action(ActionContext(action_type=action)) == ActionLevel.L1_AUTO

    def test_l2_actions(self):
        for action in [
            "restart_miner",
            "stop_miner",
            "update_miner_software_safe",
            "recover_container",
            "rent_gpu_under_cap",
            "approve_drift_correction",
            "switch_subnet_within_roi_band",
        ]:
            assert classify_action(ActionContext(action_type=action)) == ActionLevel.L2_CONFIRM

    def test_l3_actions(self):
        for action in [
            "deploy_new_miner",
            "migrate_to_new_subnet",
            "increase_daily_spend_cap",
            "rent_gpu_above_cap",
            "decommission_miner",
            "sign_payout",
            "transfer_coldkey_action",
            "config_change_revenue_split",
        ]:
            assert classify_action(ActionContext(action_type=action)) == ActionLevel.L3_MANDATORY


# --- unknown action_type: escalate to L3 (safe default) ----------------

class TestUnknownActionType:
    def test_unknown_returns_none(self):
        """Caller (request_approval helper) is responsible for escalating
        to L3 when classify_action returns None."""
        assert classify_action(ActionContext(action_type="not_a_real_action")) is None

    def test_typo_does_not_silently_pass_as_l1(self):
        """Regression: an unknown action must not look like L1."""
        level = classify_action(ActionContext(action_type="rent_gpu_under_Capp"))  # typo
        assert level is None


# --- dry-run short-circuit ---------------------------------------------

class TestDryRun:
    def test_dry_run_collapses_to_l1(self):
        # Even a normally L3 action collapses to L1 in dry-run mode
        ctx = ActionContext(action_type="deploy_new_miner", is_dry_run=True)
        assert classify_action(ctx) == ActionLevel.L1_AUTO

    def test_dry_run_with_no_action_type(self):
        # A malformed dry-run with unknown action still returns L1
        ctx = ActionContext(action_type="something_unknown", is_dry_run=True)
        assert classify_action(ctx) == ActionLevel.L1_AUTO


# --- amount escalates L1 to L2 to L3 ------------------------------------

class TestAmountEscalation:
    def test_l1_becomes_l2_at_l2_cap(self):
        ctx = ActionContext(
            action_type="refresh_metrics",
            amount_inr=DEFAULT_L2_AMOUNT_INR_CAP,  # exactly at cap
        )
        assert classify_action(ctx) == ActionLevel.L2_CONFIRM

    def test_l1_stays_l1_under_cap(self):
        ctx = ActionContext(
            action_type="refresh_metrics",
            amount_inr=DEFAULT_L2_AMOUNT_INR_CAP - 1.0,
        )
        assert classify_action(ctx) == ActionLevel.L1_AUTO

    def test_l2_escalates_to_l3_at_l3_cap(self):
        ctx = ActionContext(
            action_type="restart_miner",
            amount_inr=DEFAULT_L3_AMOUNT_INR_CAP,
        )
        assert classify_action(ctx) == ActionLevel.L3_MANDATORY

    def test_l3_stays_l3_above_cap(self):
        ctx = ActionContext(
            action_type="deploy_new_miner",
            amount_inr=DEFAULT_L3_AMOUNT_INR_CAP + 1_000_000.0,
        )
        assert classify_action(ctx) == ActionLevel.L3_MANDATORY

    def test_l1_jumps_to_l3_above_l3_cap(self):
        """An L1 action with a huge amount must NOT silently pass."""
        ctx = ActionContext(
            action_type="log_recommendation",
            amount_inr=DEFAULT_L3_AMOUNT_INR_CAP + 1.0,
        )
        assert classify_action(ctx) == ActionLevel.L3_MANDATORY

    def test_none_amount_treated_as_zero(self):
        ctx = ActionContext(action_type="refresh_metrics", amount_inr=None)
        assert classify_action(ctx) == ActionLevel.L1_AUTO


# --- risk score escalation ---------------------------------------------

class TestRiskEscalation:
    def test_high_risk_escalates_l1_to_l2(self):
        ctx = ActionContext(action_type="refresh_metrics", risk_score=30.0)
        assert classify_action(ctx) == ActionLevel.L2_CONFIRM

    def test_high_risk_escalates_l2_to_l3(self):
        ctx = ActionContext(action_type="restart_miner", risk_score=70.0)
        assert classify_action(ctx) == ActionLevel.L3_MANDATORY

    def test_low_risk_does_not_downgrade_l3(self):
        # L3 stays L3 regardless of risk (caller can already approve L3)
        ctx = ActionContext(action_type="deploy_new_miner", risk_score=0.0)
        assert classify_action(ctx) == ActionLevel.L3_MANDATORY


# --- reversibility -----------------------------------------------------

class TestReversibility:
    def test_irreversible_l1_becomes_l2(self):
        ctx = ActionContext(action_type="refresh_metrics", is_reversible=False)
        assert classify_action(ctx) == ActionLevel.L2_CONFIRM

    def test_irreversible_does_not_downgrade_l2(self):
        ctx = ActionContext(action_type="restart_miner", is_reversible=False)
        assert classify_action(ctx) == ActionLevel.L2_CONFIRM


# --- new subnet --------------------------------------------------------

class TestNewSubnet:
    def test_new_subnet_escalates_l1(self):
        ctx = ActionContext(action_type="log_recommendation", is_new_subnet=True)
        assert classify_action(ctx) == ActionLevel.L3_MANDATORY

    def test_new_subnet_escalates_l2(self):
        ctx = ActionContext(action_type="restart_miner", is_new_subnet=True)
        assert classify_action(ctx) == ActionLevel.L3_MANDATORY

    def test_new_subnet_l3_stays_l3(self):
        ctx = ActionContext(action_type="deploy_new_miner", is_new_subnet=True)
        assert classify_action(ctx) == ActionLevel.L3_MANDATORY


# --- cap customization --------------------------------------------------

class TestCustomCaps:
    def test_custom_l2_amount_cap(self):
        ctx = ActionContext(action_type="refresh_metrics", amount_inr=200.0)
        # default L2 cap is 500 -> L1, but custom cap is 100 -> L2
        assert classify_action(ctx, l2_amount_cap_inr=100.0) == ActionLevel.L2_CONFIRM
        # sanity: with default caps it's still L1
        assert classify_action(ctx) == ActionLevel.L1_AUTO

    def test_custom_l3_amount_cap(self):
        ctx = ActionContext(action_type="restart_miner", amount_inr=4000.0)
        # default L3 cap is 5000 -> L2, custom 1000 -> L3
        assert classify_action(ctx, l3_amount_cap_inr=1000.0) == ActionLevel.L3_MANDATORY
        assert classify_action(ctx) == ActionLevel.L2_CONFIRM
