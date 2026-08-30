"""Vercel serverless entry point for the FastAPI backend.

When deployed via the root api/ directory, Vercel's Python runtime
serves this as a serverless function at /api. All /api/* requests
are rewritten to this function via vercel.json rewrites.
"""
import sys
import os

# Ensure backend/ is on sys.path so 'from app.main import app' resolves
_backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from app.main import app  # noqa: E402, F401
