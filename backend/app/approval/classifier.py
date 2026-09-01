"""
L1/L2/L3 action classifier.

Every consequential action Infranex BT may take is assigned a level:

  L1_auto       - safe, reversible, no money changing hands. May execute
                  immediately and is logged to the audit trail for traceability.
                  Examples: read-only diagnostics, cache refresh, log a
                  recommendation, fetch a status snapshot.

  L2_confirm    - small financial impact (configurable threshold) OR reversible
                  operational change. Requires a single human approval.
                  Examples: rent a GPU under a per-call cap, restart a miner,
                  update miner software within a known-good range.

  L3_mandatory  - capital-intensive, irreversible, or strategy-shifting.
                  Requires explicit human approval every time. Auto-pilot
                  cannot override.
                  Examples: change miner to a new subnet, increase daily spend
                  cap, deploy a new miner on a new subnet, sign and send a
                  payout.

The classifier is intentionally rule-based and version-stamped (see
`feedback-scoring-versioned-explainable.md` in memory). It must NEVER be
an opaque ML model - every decision must be traceable to a rule.
"""
from dataclasses import dataclass
from enum import Enum


class ActionLevel(str, Enum):
    L1_AUTO = "L1_auto"
    L2_CONFIRM = "L2_confirm"
    L3_MANDATORY = "L3_mandatory"


AUTO_TRIGGER_ACTIONS: frozenset = frozenset({
    "refresh_metrics",
    "fetch_subnet_status",
    "fetch_gpu_prices",
    "log_recommendation",
    "log_drift_observation",
    "score_opportunity",
    "recompute_compatibility",
})

CONFIRM_TRIGGER_ACTIONS: frozenset = frozenset({
    "restart_miner",
    "stop_miner",
    "update_miner_software_safe",
    "recover_container",
    "rent_gpu_under_cap",
    "approve_drift_correction",
    "switch_subnet_within_roi_band",
})

MANDATORY_TRIGGER_ACTIONS: frozenset = frozenset({
    "deploy_new_miner",
    "migrate_to_new_subnet",
    "increase_daily_spend_cap",
    "rent_gpu_above_cap",
    "decommission_miner",
    "sign_payout",
    "transfer_coldkey_action",
    "config_change_revenue_split",
})


@dataclass(frozen=True)
class ActionContext:
    action_type: str
    amount_inr: float | None = None
    is_reversible: bool = True
    is_dry_run: bool = False
    risk_score: float | None = None
    target_subnet: int | None = None
    is_new_subnet: bool = False


DEFAULT_L2_AMOUNT_INR_CAP = 500.0
DEFAULT_L3_AMOUNT_INR_CAP = 5000.0
DEFAULT_L2_RISK_CAP = 30.0
DEFAULT_L3_RISK_CAP = 70.0


def classify_action(
    ctx: ActionContext,
    *,
    l2_amount_cap_inr: float = DEFAULT_L2_AMOUNT_INR_CAP,
    l3_amount_cap_inr: float = DEFAULT_L3_AMOUNT_INR_CAP,
    l2_risk_cap: float = DEFAULT_L2_RISK_CAP,
    l3_risk_cap: float = DEFAULT_L3_RISK_CAP,
) -> ActionLevel | None:
    if ctx.is_dry_run:
        return ActionLevel.L1_AUTO

    if ctx.action_type in AUTO_TRIGGER_ACTIONS:
        level = ActionLevel.L1_AUTO
    elif ctx.action_type in CONFIRM_TRIGGER_ACTIONS:
        level = ActionLevel.L2_CONFIRM
    elif ctx.action_type in MANDATORY_TRIGGER_ACTIONS:
        level = ActionLevel.L3_MANDATORY
    else:
        return None

    amount = ctx.amount_inr or 0.0
    risk = ctx.risk_score if ctx.risk_score is not None else 0.0

    if amount >= l3_amount_cap_inr and level != ActionLevel.L3_MANDATORY:
        level = ActionLevel.L3_MANDATORY
    elif amount >= l2_amount_cap_inr and level == ActionLevel.L1_AUTO:
        level = ActionLevel.L2_CONFIRM

    if risk >= l3_risk_cap and level != ActionLevel.L3_MANDATORY:
        level = ActionLevel.L3_MANDATORY
    elif risk >= l2_risk_cap and level == ActionLevel.L1_AUTO:
        level = ActionLevel.L2_CONFIRM

    if not ctx.is_reversible and level == ActionLevel.L1_AUTO:
        level = ActionLevel.L2_CONFIRM

    if ctx.is_new_subnet and level != ActionLevel.L3_MANDATORY:
        level = ActionLevel.L3_MANDATORY

    return level
