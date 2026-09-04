"""
Vercel entry point for the Infranex BT FastAPI backend.

Vercel's Python runtime looks for `app` in `api/index.py` (or any
file under `api/`) and exposes it as a serverless function.
We just re-export the FastAPI instance built in `app/main.py`.
"""
from app.main import app
