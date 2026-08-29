# Decision Engine — RUN / WATCH / AVOID

> Last updated: 2026-08-29

---

## Overview

The Decision Engine converts Opportunity Scores into actionable decisions. It combines the 3-pillar scoring model with portfolio constraints to produce a final recommendation.

```
OPPORTUNITY SCORE (0-100)
         │
         ▼
  ┌──────────────────────────────────────────────┐
  │          PORTFOLIO CONSTRAINTS               │
  │                                              │
  │  • Max concurrent miners (default: 10)       │
  │  • Max monthly spend (default: ₹500,000)     │
  │  • Max spend per miner (default: ₹50,000)    │
  │  • Min days between entries (default: 7)     │
  │  • Allowed subnet categories                 │
  │                                              │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
         FINAL DECISION
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
        RUN        WATCH       AVOID
       (≥75)     (40-74)      (<40)
```

---

## Decision Bands

### RUN (Score ≥ 75)

**Meaning:** This subnet is a strong candidate for deployment.

**Conditions:**
- All three pillars score above 60
- At least one pillar scores above 80
- Portfolio constraints are not violated

**Actions:**
1. Create deployment request (L2 approval gate)
2. Auto-approve if within portfolio constraints
3. Queue for provisioning

**Example:**
```json
{
  "decision": "RUN",
  "score": 82.5,
  "reason": "Strong utility (85) and technical (90) scores. Economics (72) is acceptable.",
  "action": "create_deployment_request",
  "approval_level": "L2_confirm"
}
```

### WATCH (Score 40-74)

**Meaning:** This subnet has potential but needs monitoring.

**Conditions:**
- Score is in the middle band
- Or portfolio constraints would be violated
- Or one pillar is significantly weak

**Actions:**
1. Add to watchlist
2. Monitor for score improvement
3. Alert if score crosses into RUN band

**Example:**
```json
{
  "decision": "WATCH",
  "score": 62.0,
  "reason": "Good technical feasibility (78) but economics (52) is weak due to high GPU costs.",
  "action": "add_to_watchlist",
  "alert_threshold": 75
}
```

### AVOID (Score < 40)

**Meaning:** This subnet is not recommended.

**Conditions:**
- Score is below the watch threshold
- Or any pillar scores below 20 (critical weakness)
- Or subnet is flagged for issues

**Actions:**
1. Do not deploy
2. If currently running, consider exit
3. Log reason for avoidance

**Example:**
```json
{
  "decision": "AVOID",
  "score": 28.5,
  "reason": "Poor utility (25) — subnet purpose is unclear. Technical (45) is marginal.",
  "action": "do_not_deploy",
  "exit_recommended": true
}
```

---

## Portfolio Constraints

Before emitting a RUN decision, the engine checks portfolio constraints:

```python
@dataclass(frozen=True)
class PortfolioConstraints:
    max_concurrent_miners: int = 10
    max_monthly_spend_inr: float = 500_000.0
    max_spend_per_miner_inr: float = 50_000.0
    min_days_between_entries: int = 7
    allowed_subnet_categories: Optional[List[str]] = None
```

### Constraint Violation Handling

| Violation | Effect |
|-----------|--------|
| Max miners reached | Downgrade RUN → WATCH |
| Monthly spend exceeded | Downgrade RUN → WATCH |
| Per-miner spend too high | Downgrade RUN → WATCH |
| Too soon since last entry | Downgrade RUN → WATCH |
| Category not allowed | Block deployment |

---

## Decision Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DECISION FLOW                                │
│                                                                 │
│  1. Compute Opportunity Score                                   │
│     ├── Utility Score (30%)                                     │
│     ├── Technical Score (35%)                                   │
│     └── Economics Score (35%)                                   │
│                                                                 │
│  2. Apply Decision Thresholds                                   │
│     ├── score >= 75 → candidate: RUN                            │
│     ├── score >= 40 → candidate: WATCH                          │
│     └── score < 40 → candidate: AVOID                           │
│                                                                 │
│  3. Check Portfolio Constraints                                 │
│     ├── If RUN and constraints violated → downgrade to WATCH    │
│     ├── If RUN and constraints OK → emit RUN                    │
│     └── WATCH/AVOID → emit as-is                                │
│                                                                 │
│  4. Apply Approval Gates                                        │
│     ├── RUN → L2_confirm (needs human approval)                 │
│     ├── WATCH → L1_auto (logged, no approval needed)            │
│     └── AVOID → L1_auto (logged, no approval needed)            │
│                                                                 │
│  5. Emit Action                                                 │
│     └── Action object consumed by Orchestrator                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Strategy Engine Integration

The Strategy Engine (`backend/app/strategy/engine.py`) consumes Opportunity Scores and emits Actions:

```python
class StrategyEngine:
    def evaluate(
        self,
        netuid: int,
        score: float,
        portfolio: PortfolioState,
    ) -> Action:
        """
        Convert Opportunity Score into an Action.
        
        Decision bands:
          score >= 75 → RUN (enter)
          40 <= score < 75 → WATCH (hold)
          score < 40 → AVOID (exit)
        """
```

### Action Types (v2.0)

| Action | v1.0 Equivalent | Description |
|--------|-----------------|-------------|
| `run` | `enter` | Deploy a new miner |
| `watch` | `hold` | Monitor, no action |
| `avoid` | `exit` | Exit if running |

---

## API Endpoints

### Get Decision for a Subnet

```
GET /api/opportunities/{netuid}/decision
```

Response:
```json
{
  "netuid": 1,
  "decision": "RUN",
  "score": 82.5,
  "pillar_scores": {
    "utility": 85.0,
    "technical": 90.0,
    "economics": 72.0
  },
  "constraints_violated": [],
  "approval_level": "L2_confirm",
  "reason": "Strong utility and technical scores. Economics is acceptable."
}
```

### Get All Decisions

```
GET /api/opportunities/decisions
```

Response:
```json
{
  "decisions": [
    {"netuid": 1, "decision": "RUN", "score": 82.5},
    {"netuid": 3, "decision": "WATCH", "score": 62.0},
    {"netuid": 64, "decision": "AVOID", "score": 28.5}
  ],
  "summary": {
    "run_count": 1,
    "watch_count": 1,
    "avoid_count": 1
  }
}
```

### Get Watchlist

```
GET /api/opportunities/watchlist
```

Returns all subnets currently in WATCH state, sorted by score.

---

## Frontend Display

### Decision Badges

| Decision | Badge Color | Icon |
|----------|-------------|------|
| RUN | Green | ▶ |
| WATCH | Yellow | 👁 |
| AVOID | Red | ✕ |

### Pillar Breakdown Chart

```
Utility    ████████████████████████████████░░░░  68%
Technical  █████████████████████████████████████░  82%
Economics  █████████████████████████████░░░░░░░░░  65%
           ─────────────────────────────────────
Total      ██████████████████████████████░░░░░░░  72.5
```

### Opportunity Table Columns

| Column | Source |
|--------|--------|
| Subnet | `subnet_name` |
| Score | `total_score` |
| Decision | `decision` |
| Utility | `pillar_scores.utility` |
| Technical | `pillar_scores.technical` |
| Economics | `pillar_scores.economics` |
| Action | Based on decision |

---

## Configuration

```python
# backend/app/strategy/engine.py

DECISION_THRESHOLDS = {
    "run": 75.0,      # Score >= 75 → RUN
    "watch": 40.0,    # Score >= 40 → WATCH
    # Below 40 → AVOID
}

# Portfolio constraints
DEFAULT_CONSTRAINTS = PortfolioConstraints(
    max_concurrent_miners=10,
    max_monthly_spend_inr=500_000.0,
    max_spend_per_miner_inr=50_000.0,
    min_days_between_entries=7,
)
```

---

## Monitoring & Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Score crossed into RUN | Score ≥ 75 | Info |
| Score dropped to AVOID | Score < 40 | Critical |
| Pillar critically weak | Any pillar < 20 | Warning |
| Decision changed | RUN→WATCH or WATCH→AVOID | Warning |
| Watchlist opportunity | WATCH score increased by 10+ | Info |

---

## Migration from v1.0

| v1.0 | v2.0 | Notes |
|------|------|-------|
| ENTER | RUN | Same threshold (≥75) |
| HOLD | WATCH | Same band (40-74) |
| EXIT | AVOID | Same threshold (<40) |
| 8 components | 3 pillars | Simpler, more intuitive |
| `action_type: "enter"` | `action_type: "run"` | Updated labels |
| `action_type: "hold"` | `action_type: "watch"` | Updated labels |
| `action_type: "exit"` | `action_type: "avoid"` | Updated labels |
