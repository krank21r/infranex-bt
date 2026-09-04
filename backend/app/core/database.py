"""
Database module for Infranex BT.

Uses a single DATABASE_URL env var for the SQLAlchemy async engine (Supabase
Postgres direct connection string), and the Supabase REST client for auth.

The previous version tried to derive the Postgres hostname from the Supabase
URL — that was wrong. The Supabase URL is the API gateway, not the DB.

For serverless (Vercel), uses Supabase PgBouncer pooler (port 6543) via
DATABASE_POOLER_URL. For local development, uses direct connection.
"""
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

try:
    import asyncpg
    ASYNCPG_AVAILABLE = True
except ImportError:
    asyncpg = None
    ASYNCPG_AVAILABLE = False

from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from supabase import Client, create_client

from app.core.config import settings

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Manages database connections (Supabase REST + async SQLAlchemy)."""

    def __init__(self):
        self._supabase_client: Client | None = None
        self._supabase_admin_client: Client | None = None
        self._async_engine = None
        self._async_session_factory: async_sessionmaker | None = None
        self._sync_engine = None
        self._sync_session_factory: sessionmaker | None = None
        self._asyncpg_pool: asyncpg.Pool | None = None

    # --- Supabase Clients ---

    def get_supabase_client(self) -> Client:
        if self._supabase_client is None:
            if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
                raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")
            self._supabase_client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_ANON_KEY,
            )
        return self._supabase_client

    def get_supabase_admin_client(self) -> Client:
        if self._supabase_admin_client is None:
            if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
                raise ValueError(
                    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
                )
            self._supabase_admin_client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_SERVICE_ROLE_KEY,
            )
        return self._supabase_admin_client

    # --- Async SQLAlchemy Engine ---

    def get_async_engine(self):
        if self._async_engine is None:
            db_url = self._build_async_db_url()

            # For serverless (Vercel), use NullPool to avoid connection issues
            if settings.APP_ENV == "production":
                connect_args = {}
                # Supabase pooler requires SSL - use require mode and disable cert verification
                # for serverless environments where the CA bundle may not be available
                if "pooler.supabase.com" in db_url:
                    import ssl
                    ssl_ctx = ssl.create_default_context()
                    ssl_ctx.check_hostname = False
                    ssl_ctx.verify_mode = ssl.CERT_NONE
                    connect_args["ssl"] = ssl_ctx
                # Disable asyncpg prepared-statement cache: PgBouncer in transaction mode
                # recycles server-side prepared statements across clients, causing
                # "DuplicatePreparedStatementError" on the second query in a session.
                connect_args["statement_cache_size"] = 0
                self._async_engine = create_async_engine(
                    db_url,
                    poolclass=NullPool,
                    pool_pre_ping=True,
                    echo=False,
                    connect_args=connect_args,
                )
            else:
                self._async_engine = create_async_engine(
                    db_url,
                    pool_size=settings.DATABASE_POOL_SIZE,
                    max_overflow=settings.DATABASE_MAX_OVERFLOW,
                    pool_timeout=settings.DATABASE_POOL_TIMEOUT,
                    pool_pre_ping=True,
                    echo=False,
                )
        return self._async_engine

    def get_async_session_factory(self) -> async_sessionmaker:
        if self._async_session_factory is None:
            self._async_session_factory = async_sessionmaker(
                self.get_async_engine(),
                class_=AsyncSession,
                expire_on_commit=False,
                autoflush=False,
            )
        return self._async_session_factory

    @asynccontextmanager
    async def get_async_session(self) -> AsyncGenerator[AsyncSession, None]:
        factory = self.get_async_session_factory()
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    # --- Sync SQLAlchemy Engine ---

    def get_sync_engine(self):
        if self._sync_engine is None:
            db_url = self._build_sync_db_url()
            if settings.APP_ENV == "production":
                self._sync_engine = create_engine(
                    db_url,
                    poolclass=NullPool,
                    pool_pre_ping=True,
                )
            else:
                self._sync_engine = create_engine(
                    db_url,
                    pool_size=settings.DATABASE_POOL_SIZE,
                    max_overflow=settings.DATABASE_MAX_OVERFLOW,
                    pool_timeout=settings.DATABASE_POOL_TIMEOUT,
                    pool_pre_ping=True,
                )
        return self._sync_engine

    def get_sync_session_factory(self) -> sessionmaker:
        if self._sync_session_factory is None:
            self._sync_session_factory = sessionmaker(
                self.get_sync_engine(),
                expire_on_commit=False,
                autoflush=False,
            )
        return self._sync_session_factory

    # --- Helpers ---

    def _build_async_db_url(self) -> str:
        """Build async database URL, using pooler in production."""
        url = settings.effective_database_url
        if url:
            if url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
            # Remove any sslmode/ssl params from URL - we pass SSL via connect_args
            if "?" in url:
                base, query = url.split("?", 1)
                params = [p for p in query.split("&") if not p.startswith(("sslmode", "ssl="))]
                if params:
                    url = f"{base}?{'&'.join(params)}"
                else:
                    url = base
            return url
        raise ValueError(
            "DATABASE_URL is not set. Configure the Supabase Postgres direct "
            "connection string in DATABASE_URL (e.g. postgresql://postgres:..."
            "@db.<project-ref>.supabase.co:5432/postgres)."
        )

    def _build_sync_db_url(self) -> str:
        """Build sync database URL, using pooler in production."""
        url = settings.effective_database_url
        if url:
            if url.startswith("postgresql+asyncpg://"):
                url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
            # Supabase pooler requires SSL
            if "pooler.supabase.com" in url and "sslmode" not in url:
                url += "?sslmode=require"
            return url
        raise ValueError("DATABASE_URL is not set")

    async def ping(self) -> bool:
        """Lightweight SELECT 1 health check."""
        try:
            engine = self.get_async_engine()
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception as e:
            logger.warning("Database ping failed: %s", e)
            return False

    async def close(self):
        if self._async_engine:
            await self._async_engine.dispose()
        if self._sync_engine:
            self._sync_engine.dispose()
        self._supabase_client = None
        self._supabase_admin_client = None


db_manager = DatabaseManager()


# --- Dependency Functions ---

async def get_supabase() -> Client:
    return db_manager.get_supabase_client()


async def get_supabase_admin() -> Client:
    return db_manager.get_supabase_admin_client()


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with db_manager.get_async_session() as session:
        yield session


# --- Startup/Shutdown ---

async def init_database():
    """Initialize database connections on startup. Non-fatal if DB is down."""
    import logging
    logger = logging.getLogger(__name__)
    if settings.DATABASE_URL or settings.DATABASE_POOLER_URL:
        try:
            ok = await db_manager.ping()
            if ok:
                logger.info("Database connection established")
            else:
                logger.warning("Database ping failed — continuing in degraded mode")
        except Exception as e:
            logger.error("Database initialization error: %s", str(e), exc_info=True)
    else:
        logger.warning(
            "DATABASE_URL not configured — backend will run in mock mode"
        )


async def close_database():
    await db_manager.close()
    logger.info("Database connections closed")
