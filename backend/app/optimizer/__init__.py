"""
Optimizer module — cost savings, subnet alternatives, and config tweaks.

Pure-Python computation lives in `optimizer.py`. The `Optimizer` class
is the thin DB-reading orchestrator (no writes). Writes go through the
approval + deployment service layers.
"""
from app.optimizer.optimizer import (
    Optimizer,
    CheaperOffer,
    SubnetAlternative,
    ConfigSuggestion,
    OPTIMIZER_MODEL_VERSION,
)

__all__ = [
    "Optimizer",
    "CheaperOffer",
    "SubnetAlternative",
    "ConfigSuggestion",
    "OPTIMIZER_MODEL_VERSION",
]
