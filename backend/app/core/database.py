"""
Database module for Infranex BT.

Uses a single DATABASE_URL env var for the SQLAlchemy async engine (Supabase
Postgres direct connection string), and the Supabase REST client for auth.

The previous version tried to derive the Postgres hostname from the Supabase
URL — that was wrong. The Supabase URL is the API gateway, not the DB.
"""
import logging
from contextlib import asynccontextmanager
from typing import Optional, AsyncGenerator

try:
    import asyncpg
    ASYNCPG_AVAILABLE = True
except ImportError:
    asyncpg = None
    ASYNCPG_AVAILABLE = False

from supabase import create_client, Client
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.core.config import settings

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Manages database connections (Supabase REST + async SQLAlchemy)."""

    def __init__(self):
        self._supabase_client: Optional[Client] = None
        self._supabase_admin_client: Optional[Client] = None
        self._async_engine = None
        self._async_session_factory: Optional[async_sessionmaker] = None
        self._sync_engine = None
        self._sync_session_factory: Optional[sessionmaker] = None
        self._asyncpg_pool: Optional["asyncpg.Pool"] = None

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
        url = settings.DATABASE_URL
        if url:
            if url.startswith("postgresql://"):
                return url.replace("postgresql://", "postgresql+asyncpg://", 1)
            return url
        raise ValueError(
            "DATABASE_URL is not set. Configure the Supabase Postgres direct "
            "connection string in DATABASE_URL (e.g. postgresql://postgres:..."
            "@db.<project-ref>.supabase.co:5432/postgres)."
        )

    def _build_sync_db_url(self) -> str:
        url = settings.DATABASE_URL
        if url:
            if url.startswith("postgresql+asyncpg://"):
                return url.replace("postgresql+asyncpg://", "postgresql://", 1)
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
    if settings.DATABASE_URL:
        ok = await db_manager.ping()
        if ok:
            logger.info("Database connection established")
        else:
            logger.warning("Database ping failed — continuing in degraded mode")
    else:
        logger.warning(
            "DATABASE_URL not configured — backend will run in mock mode"
        )


async def close_database():
    await db_manager.close()
    logger.info("Database connections closed")
