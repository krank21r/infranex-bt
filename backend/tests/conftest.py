"""
Top-level conftest for the backend test suite.

Ensures the `app` package is importable when pytest is invoked from any
working directory, so test modules can simply do `from app.x import y`.

Without this, pytest run from the repo root or directly via the venv
executable fails with `ModuleNotFoundError: No module named 'app'`. The
older `run_tests.py` wrapper handled this by hardcoding a sys.path
insert; the conftest is the proper, test-runner-agnostic home for it.
"""
import os
import sys

_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)
