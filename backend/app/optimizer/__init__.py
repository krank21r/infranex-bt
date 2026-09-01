"""
Optimizer module — cost savings, subnet alternatives, and config tweaks.

Pure-Python computation lives in `optimizer.py`. The `Optimizer` class
is the thin DB-reading orchestrator (no writes). Writes go through the
approval + deployment service layers.
"""
from app.optimizer.optimizer import (
    OPTIMIZER_MODEL_VERSION,
    CheaperOffer,
    ConfigSuggestion,
    Optimizer,
    SubnetAlternative,
)

__all__ = [
    "OPTIMIZER_MODEL_VERSION",
    "CheaperOffer",
    "ConfigSuggestion",
    "Optimizer",
    "SubnetAlternative",
]
