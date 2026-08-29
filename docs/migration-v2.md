# v2.0 Architecture Migration Guide

> Last updated: 2026-08-29

---

## Summary

The v2.0 scoring model replaces the v1.0 8-component scoring system with a cleaner 3-pillar model:

| v1.0 | v2.0 |
|------|------|
| 8 technical components | 3 intuitive pillars |
| ENTER / HOLD / EXIT | RUN / WATCH / AVOID |
| Complex weighting | Simple 30/35/35 split |
| Hard to explain | Easy to understand |

---

## Architecture Comparison

### v1.0 (8 Components)
```
economic_potential (20%)
competition (15%)
reward_stability (15%)
market_conditions (10%)
new_miner_accessibility (10%)
network_health (10%)
hardware_suitability (10%)
profitability_potential (10%)
         ↓
   Opportunity Score
         ↓
   ENTER / HOLD / EXIT
```

### v2.0 (3 Pillars)
```
  Utility (30%)    Technical (35%)    Economics (35%)
       │                │                   │
       └────────────────┼───────────────────┘
                        ↓
              Opportunity Score
                        ↓
              RUN / WATCH / AVOID
```

---

## Pillar Mapping

### Utility (30%) — NEW
**Question:** What does the subnet actually do?

| Factor | Weight | Source |
|--------|--------|--------|
| Problem clarity | 30% | README analysis |
| Uniqueness | 20% | Subnet metadata |
| Description quality | 15% | Subnet description |
| Development activity | 15% | GitHub commits |
| Tokenomics | 10% | Subnet registration |
| Governance | 10% | Subnet metadata |

### Technical (35%) — Absorbs `hardware_suitability`
**Question:** Can we run this subnet?

| Factor | Weight | Source |
|--------|--------|--------|
| GPU match rate | 40% | `SubnetRequirement` + `GPUModel` |
| Dependency simplicity | 20% | `SubnetRequirement.dependencies` |
| CUDA compatibility | 15% | `SubnetRequirement.cuda_version` |
| Resource feasibility | 15% | `SubnetRequirement.ram_gb`, `storage_gb` |
| Data confidence | 10% | `SubnetRequirement.extraction_confidence` |

### Economics (35%) — Absorbs 4 v1.0 components
**Question:** Will it be profitable?

| Factor | Weight | Source |
|--------|--------|--------|
| Revenue potential | 30% | `SubnetMetrics.emission`, `average_incentive` |
| Competition health | 20% | `SubnetMetrics.top_5_concentration` |
| Reward stability | 15% | `SubnetMetrics.top_incentive`, `median_incentive` |
| Cost efficiency | 20% | GPU cost vs expected revenue |
| Market momentum | 15% | `MarketData.alpha_price_1d_change`, `liquidity` |

---

## Decision Mapping

| Score | v1.0 | v2.0 | Action |
|-------|------|------|--------|
| ≥ 75 | ENTER | **RUN** | Deploy miner |
| 40-74 | HOLD | **WATCH** | Monitor |
| < 40 | EXIT | **AVOID** | Exit if running |

---

## File Changes

### Backend

| File | Change |
|------|--------|
| `backend/app/intelligence/__init__.py` | Refactor to 3-pillar model |
| `backend/app/strategy/engine.py` | Update thresholds + action labels |
| `backend/app/services/opportunity_service.py` | Update to call new scoring |
| `backend/app/api/routes/opportunities.py` | Add v2 endpoints |
| `backend/app/learning/feedback.py` | Track pillar scores |
| `backend/app/learning/tracker.py` | Track pillar accuracy |
| `backend/app/optimizer/optimizer.py` | Use pillar scores |
| `backend/app/models/opportunity.py` | Add pillar score columns |
| `backend/app/schemas/opportunity.py` | Add pillar score schema |
| `backend/alembic/versions/` | Add migration for new columns |

### Frontend

| File | Change |
|------|--------|
| `frontend/app/opportunities/page.tsx` | Show 3 pillar breakdown |
| `frontend/app/dashboard/page.tsx` | Show RUN/WATCH/AVOID badges |
| `frontend/types/index.ts` | Update Opportunity type |
| `frontend/components/cards/pillar-card.tsx` | New component |
| `frontend/components/charts/pillar-chart.tsx` | New component |

---

## Database Migration

### New Columns on `opportunity_scores`

```sql
ALTER TABLE opportunity_scores
  ADD COLUMN utility_score FLOAT,
  ADD COLUMN technical_score FLOAT,
  ADD COLUMN economics_score FLOAT,
  ADD COLUMN pillar_version VARCHAR(10) DEFAULT 'v2.0',
  ADD COLUMN decision VARCHAR(10);
```

### New Table: `utility_assessments`

```sql
CREATE TABLE utility_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  netuid INTEGER,
  problem_clarity FLOAT,
  uniqueness FLOAT,
  description_quality FLOAT,
  development_activity FLOAT,
  tokenomics_score FLOAT,
  governance_score FLOAT,
  overall_utility FLOAT,
  assessed_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Implementation Order

1. **Database migration** — Add new columns and table
2. **Scoring engine** — Implement 3-pillar scoring in `intelligence/__init__.py`
3. **API routes** — Add v2 endpoints
4. **Strategy engine** — Update to use new decision labels
5. **Opportunity service** — Update to persist pillar scores
6. **Learning engine** — Update to track pillar accuracy
7. **Frontend types** — Update TypeScript interfaces
8. **Frontend components** — Add pillar visualization
9. **Tests** — Write tests for new scoring
10. **Documentation** — Update API docs

---

## Backward Compatibility

- v1.0 scoring remains available at `/api/v1/opportunities/{netuid}/score`
- v2.0 scoring at `/api/v2/opportunities/{netuid}/score`
- Frontend can toggle between views
- Existing `OpportunityScore` rows keep their v1.0 data
- New rows include both v1.0 and v2.0 scores during transition

---

## Testing Strategy

### Unit Tests
- `test_utility_score_calculation()` — Utility pillar math
- `test_technical_score_calculation()` — Technical pillar math
- `test_economics_score_calculation()` — Economics pillar math
- `test_opportunity_score_combination()` — Weighted combination
- `test_decision_mapping()` → Score → Decision mapping

### Integration Tests
- `test_full_scoring_pipeline()` — End-to-end scoring
- `test_persistence()` — Scores saved correctly
- `test_api_response_format()` — API returns expected shape

### Regression Tests
- `test_backward_compatibility()` — v1.0 still works
- `test_migration_script()` — Migration runs cleanly

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Scoring accuracy | ≥ 80% prediction vs actual ROI |
| API response time | < 200ms per score |
| Frontend render | < 100ms for pillar chart |
| Test coverage | ≥ 90% for scoring module |
| Migration downtime | Zero (backward compatible) |

---

## Documentation

| Document | Location |
|----------|----------|
| Architecture Overview | `docs/architecture/overview.md` |
| v2 Scoring Engine | `docs/architecture/v2-scoring-engine.md` |
| Decision Engine | `docs/architecture/decision-engine.md` |
| Scoring API | `docs/api/scoring.md` |
| Migration Guide | `docs/migration-v2.md` (this file) |
