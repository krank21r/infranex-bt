"""
External API clients (Bittensor chain, GPU providers, market data, etc.).

Each client module exposes a thin ABC over a specific external surface plus
Fake* implementations that the rest of the app can run against in mock mode.
"""
