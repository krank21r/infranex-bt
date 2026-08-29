"""
Market Data Worker - Fetches real-time market data.

Responsible for fetching and maintaining market data including:
- Cryptocurrency prices (TAO, BTC, ETH, etc.) via CoinGecko
- Fiat exchange rates (USD/INR) via exchangerate.host
- GPU market pricing from providers (stub for now)
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from app.workers.base import BaseWorker, RetryConfig, StructuredLogger
from app.models import MarketData
from app.core.database import db_manager
from app.core.config import settings

logger = logging.getLogger(__name__)


class MarketDataWorker(BaseWorker):
    """
    Worker for fetching and caching market data.

    Fetches:
    - TAO price from CoinGecko (free, no API key)
    - USD/INR exchange rate from exchangerate.host (free, no API key)
    - GPU spot prices from providers (stub - requires API keys)
    """

    # Free public APIs (no auth required)
    COINGECKO_URL = "https://api.coingecko.com/api/v3"
    EXCHANGERATE_URL = "https://api.exchangerate.host"

    def __init__(
        self,
        interval_seconds: float = 60.0,  # 1 minute for market data
        config: Optional[Dict[str, Any]] = None,
    ):
        retry_config = RetryConfig(
            max_attempts=3,
            base_delay=1.0,
            max_delay=10.0,
            retryable_exceptions=(Exception,),
        )
        super().__init__(
            name="market_data",
            interval_seconds=interval_seconds,
            retry_config=retry_config,
        )
        self.config = config or {}
        self.logger = StructuredLogger("worker.market_data")
        self._price_symbols: List[str] = self.config.get(
            "price_symbols",
            ["TAO", "BTC", "ETH", "SOL", "USDT"]
        )
        self._fx_pairs: List[str] = self.config.get("fx_pairs", ["USD/INR"])
        self._cache_ttl_seconds: int = self.config.get("cache_ttl_seconds", 120)
        self._http_client: Optional[httpx.AsyncClient] = None

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client with reasonable defaults."""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(10.0, connect=5.0),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._http_client


        """
        Fetch cryptocurrency prices from CoinGecko.

        Returns:
            Dict mapping symbol to price data with USD and INR prices.
        """
        client = await self._get_http_client()
        prices: Dict[str, Dict[str, Any]] = {}
        
        # Map our symbols to CoinGecko IDs
        symbol_to_coingecko = {
            "TAO": "bittensor",
            "BTC": "bitcoin",
            "ETH": "ethereum",
            "SOL": "solana",
            "USDT": "tether",
        }
        
        coingecko_ids = [symbol_to_coingecko.get(s) for s in self._price_symbols if s in symbol_to_coingecko]
        if not coingecko_ids:
            return prices
        
        try:
            # Single API call for all prices
            ids_param = ",".join(coingecko_ids)
            url = f"{self.COINGECKO_URL}/simple/price"
            params = {
                "ids": ids_param,
                "vs_currencies": "usd,inr",
                "include_24hr_change": "true",
                "include_24hr_vol": "true",
                "include_market_cap": "true",
            }
            
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            timestamp = int(datetime.now(timezone.utc).timestamp())
            
            for symbol, cg_id in symbol_to_coingecko.items():
                if cg_id in data:
                    coin_data = data[cg_id]
                    prices[symbol] = {
                        "price_usd": coin_data.get("usd"),
                        "price_inr": coin_data.get("inr"),
                        "change_24h_pct": coin_data.get("usd_24h_change"),
                        "volume_24h_usd": coin_data.get("usd_24h_vol"),
                        "market_cap_usd": coin_data.get("usd_market_cap"),
                        "source": "coingecko",
                        "timestamp": timestamp,
                    }
                    
            logger.info("Fetched crypto prices", symbols=list(prices.keys()))
            
        except httpx.HTTPError as e:
            logger.error("Failed to fetch crypto prices", error=str(e))
        except Exception as e:
            logger.error("Unexpected error fetching crypto prices", error=str(e))
            
        return prices

    async def _fetch_fx_rates(self) -> Dict[str, Dict[str, Any]]:
        """
        Fetch foreign exchange rates.
        
        Note: exchangerate.host now requires API key. 
        We use CoinGecko's INR prices directly, but keep this for 
        explicit USD/INR rate if needed for other calculations.
        
        Returns:
            Dict mapping pair to rate data (empty if no free source available).
        """
        # CoinGecko already provides INR prices in _fetch_crypto_prices
        # This method is kept for explicit FX rate fetching if needed
        # exchangerate.host requires API key: https://exchangerate.host/#/dashboard
        logger.debug("FX rate fetch skipped (using CoinGecko INR prices directly)")
        return {}

    async def _fetch_gpu_spot_prices(self) -> Dict[str, Any]:
        """
        Fetch current GPU spot/on-demand pricing from providers.
        
        Note: This is a stub. Real implementation requires API keys for:
        - RunPod, Vast.ai, TensorDock, E2E Networks, Yotta
        
        Returns:
            Dict with provider pricing (empty until API keys configured).
        """
        # TODO: Implement when provider API keys are available
        # Example structure:
        # {
        #     "runpod": {"H100": 4.89, "A100": 2.50, "RTX_4090": 0.69},
        #     "vast": {"H100": 3.20, "A100": 1.80, "RTX_4090": 0.45},
        # }
        
        logger.debug("GPU spot price fetch not yet implemented (requires API keys)")
        return {}

    async def _validate_and_persist(
        self,
        crypto_prices: Dict[str, Any],
        fx_rates: Dict[str, Any],
        gpu_prices: Dict[str, Any],
    ) -> None:
        """
        Validate fetched data and persist to database.
        
        Creates a MarketData row with the latest TAO price.
        Uses CoinGecko's INR price directly (no separate FX API needed).
        """
        # Validate we have minimum required data
        tao_data = crypto_prices.get("TAO", {})
        if not tao_data.get("price_usd"):
            logger.warning("TAO price not available, skipping persist")
            return
        
        tao_price_usd = tao_data["price_usd"]
        tao_price_inr = tao_data.get("price_inr") or (tao_price_usd * 83.5)  # Fallback to config
        
        # Calculate 24h change
        change_24h = tao_data.get("change_24h_pct", 0.0)
        
        try:
            # Use sync engine for simplicity in worker
            sync_session_factory = db_manager.get_sync_session_factory()
            with sync_session_factory() as session:
                market_row = MarketData(
                    netuid=None,  # Global market data, not subnet-specific
                    alpha_price=None,  # Subnet-specific, not global
                    alpha_price_1d_change=change_24h,
                    market_cap=tao_data.get("market_cap_usd"),
                    volume_24h=tao_data.get("volume_24h_usd"),
                    volume_market_cap_ratio=None,
                    liquidity=None,
                    liquidity_change=None,
                    buy_activity=None,
                    emission_rate=None,
                    emission_percentage=None,
                    incentive_burn=None,
                    tao_price_usd=tao_price_usd,
                    tao_price_inr=tao_price_inr,
                    data_source="coingecko",
                )
                session.add(market_row)
                session.commit()
                
            logger.info(
                "Persisted market data",
                tao_price_usd=tao_price_usd,
                tao_price_inr=tao_price_inr,
                change_24h_pct=change_24h,
            )
            
        except Exception as e:
            logger.error("Failed to persist market data", error=str(e))
            raise

    async def _cache_prices(self, crypto_prices: Dict[str, Any], fx_rates: Dict[str, Any]) -> None:
        """Cache prices in Upstash Redis for fast API access (if configured)."""
        if not settings.UPSTASH_REDIS_REST_URL or not settings.UPSTASH_REDIS_REST_TOKEN:
            logger.debug("Upstash Redis not configured, skipping cache")
            return
            
        try:
            client = await self._get_http_client()
            
            # Cache TAO price specifically
            tao_data = crypto_prices.get("TAO", {})
            if tao_data:
                cache_data = {
                    "tao_price_usd": tao_data.get("price_usd"),
                    "tao_price_inr": tao_data.get("price_inr"),
                    "change_24h_pct": tao_data.get("change_24h_pct"),
                    "timestamp": tao_data.get("timestamp"),
                }
                
                # Upstash REST API: SET key value EX ttl
                headers = {"Authorization": f"Bearer {settings.UPSTASH_REDIS_REST_TOKEN}"}
                await client.post(
                    f"{settings.UPSTASH_REDIS_REST_URL}/set/market:tao_price/{cache_data['timestamp']}/{cache_data['tao_price_usd']}",
                    headers=headers,
                    json=cache_data,
                )
                logger.debug("Cached TAO price in Upstash Redis")
                
        except Exception as e:
            logger.warning("Failed to cache prices in Redis", error=str(e))

    async def run(self) -> None:
        """Main market data fetch loop."""
        self.logger.info("Starting market data fetch cycle")

        try:
            # 1. Fetch crypto prices (TAO, BTC, ETH, etc.)
            crypto_prices = await self._fetch_crypto_prices()
            
            # 2. Fetch FX rates (USD/INR)
            fx_rates = await self._fetch_fx_rates()
            
            # 3. Fetch GPU spot prices (stub for now - requires API keys)
            gpu_prices = await self._fetch_gpu_spot_prices()
            
            # 4. Validate and persist to database
            await self._validate_and_persist(crypto_prices, fx_rates, gpu_prices)
            
            # 5. Cache in Redis (if available)
            await self._cache_prices(crypto_prices, fx_rates)
            
            self.logger.info(
                "Market data fetch cycle completed",
                crypto_symbols=len(crypto_prices),
                fx_pairs=len(fx_rates),
                gpu_providers=len(gpu_prices),
            )
            
        except Exception as e:
            self.logger.error("Market data fetch cycle failed", error=str(e))
            raise

    async def _publish_price_updates(self, data: Dict[str, Any]) -> None:
        """Publish price updates to message queue for downstream consumers (stub)."""
        # Future: implement via Redis pub/sub or message queue
        pass

    def get_cached_prices(self) -> Dict[str, Any]:
        """Get latest cached prices (stub - use DB query instead)."""
        return {}

    async def close(self) -> None:
        """Close HTTP client on shutdown."""
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()


def create_market_data_worker(
    interval_seconds: float = 60.0,
    config: Optional[Dict[str, Any]] = None,
) -> MarketDataWorker:
    """Create a configured MarketDataWorker instance."""
    return MarketDataWorker(interval_seconds=interval_seconds, config=config)