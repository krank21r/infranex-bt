import os

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _bool(v: str | bool | None, default: bool = False) -> bool:
    if isinstance(v, bool):
        return v
    if v is None or v == "":
        return default
    return v.strip().lower() in ("true", "1", "yes")


def _int(v: str | int | None, default: int = 0) -> int:
    if isinstance(v, int):
        return v
    if v is None or v == "":
        return default
    return int(v)


def _float(v: str | float | None, default: float = 0.0) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    if v is None or v == "":
        return default
    return float(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_2=".env.local", env_file_encoding="utf-8", case_sensitive=True)
    # Application
    APP_NAME: str = "Infranex BT"
    APP_ENV: str = "development"
    DEPLOYMENT_MODE: str = "mock"  # mock | production
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"
    API_V1_PREFIX: str = "/api"
    PROJECT_ROOT: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    # Supabase
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""

    # Database (PostgreSQL via Supabase)
    DATABASE_URL: str = ""
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20
    DATABASE_POOL_TIMEOUT: int = 30
    # Use Supabase PgBouncer pooler (port 6543) for serverless
    DATABASE_POOLER_URL: str = ""

    # Bittensor
    BITTENSOR_NETWORK: str = "testnet"
    # Default endpoint matches BITTENSOR_NETWORK=testnet. Override BITTENSOR_RPC_ENDPOINT
    # in production (e.g. wss://entrypoint-finney.opentensor.ai:443 for finney/mainnet).
    BITTENSOR_RPC_ENDPOINT: str = "wss://test.finney.opentensor.ai:443"

    # Redis (Upstash for serverless)
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_MAX_CONNECTIONS: int = 50
    UPSTASH_REDIS_REST_URL: str = ""
    UPSTASH_REDIS_REST_TOKEN: str = ""

    # Celery (disabled on Vercel - use Cron instead)
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # GitHub
    GITHUB_TOKEN: str = ""
    GITHUB_API_BASE: str = "https://api.github.com"
    ANALYZER_FETCH_TIMEOUT_SECONDS: float = 20.0

    @model_validator(mode='before')
    @classmethod
    def handle_empty_env_vars(cls, data):
        """Convert empty-string env vars to their defaults so Pydantic can parse them."""
        if not isinstance(data, dict):
            return data
        bool_defaults = {"DEBUG": True}
        int_defaults = {
            "SCANNER_FAST_INTERVAL_SECONDS": 300,
            "SCANNER_MEDIUM_INTERVAL_SECONDS": 900,
            "SCANNER_SLOW_INTERVAL_SECONDS": 86400,
            "DATABASE_POOL_SIZE": 10,
            "DATABASE_MAX_OVERFLOW": 20,
            "DATABASE_POOL_TIMEOUT": 30,
            "REDIS_MAX_CONNECTIONS": 50,
            "RATE_LIMIT_REQUESTS": 100,
            "RATE_LIMIT_WINDOW_SECONDS": 60,
            "ACCESS_TOKEN_EXPIRE_MINUTES": 30,
            "REFRESH_TOKEN_EXPIRE_DAYS": 7,
            "DEFAULT_PAGE_SIZE": 20,
            "MAX_PAGE_SIZE": 100,
            "METRICS_PORT": 9090,
        }
        float_defaults = {"USD_TO_INR": 83.5, "ANALYZER_FETCH_TIMEOUT_SECONDS": 20.0}
        str_defaults = {"APP_NAME": "Infranex BT", "APP_ENV": "development", "LOG_LEVEL": "INFO"}
        for k, v in data.items():
            if isinstance(v, str) and v.strip() == "":
                if k in bool_defaults:
                    data[k] = bool_defaults[k]
                elif k in int_defaults:
                    data[k] = int_defaults[k]
                elif k in float_defaults:
                    data[k] = float_defaults[k]
                elif k in str_defaults:
                    data[k] = str_defaults[k]
        return data

    @model_validator(mode='after')
    def strip_whitespace(self):
        """Strip whitespace and newlines from string fields."""
        for field_name in self.model_fields:
            field_value = getattr(self, field_name)
            if isinstance(field_value, str):
                stripped = field_value.strip()
                if stripped != field_value:
                    setattr(self, field_name, stripped)
        return self
    # JSON: {"1": "owner/repo", "3": "owner/repo2"} — wins over the curated default map.
    ANALYZER_REPO_OVERRIDES: str = ""

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:8000,http://127.0.0.1:3000,http://127.0.0.1:8000"

    # Security
    SECRET_KEY: str = "change-this-to-a-random-secret-key"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Cron (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`)
    CRON_SECRET: str = ""

    # Admin (gate behind /admin/seed and similar operational endpoints)
    ADMIN_SECRET: str = ""

    # Rate Limiting
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    # Scanner intervals (seconds)
    SCANNER_FAST_INTERVAL_SECONDS: int = 300
    SCANNER_MEDIUM_INTERVAL_SECONDS: int = 900
    SCANNER_SLOW_INTERVAL_SECONDS: int = 86400

    # Currency
    DEFAULT_CURRENCY: str = "INR"
    USD_TO_INR: float = 83.5

    # Pagination
    DEFAULT_PAGE_SIZE: int = 20
    MAX_PAGE_SIZE: int = 100

    # Monitoring
    ENABLE_METRICS: bool = True
    METRICS_PORT: int = 9090

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def database_url_sync(self) -> str:
        """Convert asyncpg URL to sync psycopg2 URL"""
        url = self.DATABASE_URL
        if url.startswith("postgresql+asyncpg://"):
            return url.replace("postgresql+asyncpg://", "postgresql://")
        return url

    @property
    def effective_database_url(self) -> str:
        """
        Returns the appropriate database URL for the current environment.
        In production (Vercel), use the pooler URL if available.
        """
        if self.APP_ENV == "production" and self.DATABASE_POOLER_URL:
            return self.DATABASE_POOLER_URL.strip()
        return self.DATABASE_URL.strip()

    @property
    def effective_redis_url(self) -> str:
        """
        Returns the appropriate Redis URL.
        In production, prefer Upstash REST if configured.
        """
        if self.APP_ENV == "production" and self.UPSTASH_REDIS_REST_URL:
            return self.UPSTASH_REDIS_REST_URL
        return self.REDIS_URL

settings = Settings()
