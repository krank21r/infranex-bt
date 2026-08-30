"""Vercel serverless entry point for the FastAPI backend.
Catch-all route that handles all /api/* requests.
"""
from backend.app.main import app  # noqa: F401
