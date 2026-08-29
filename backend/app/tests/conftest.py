"""
Conftest for app/tests.

Injects light module stubs for dependencies that are incompatible
with the Python 3.15 beta in this environment (greenlet/SQLAlchemy
C-extension mismatch).
"""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock


def _install_stub(name: str, module: types.ModuleType) -> None:
    if name not in sys.modules:
        sys.modules[name] = module


class _ColumnFactory:
    """Return a _ColumnFactory for any attribute access, call, or comparison."""
    def __call__(self, *a, **kw): return _ColumnFactory()
    def __getattr__(self, name): return _ColumnFactory()
    def __getitem__(self, item): return _ColumnFactory()
    def __ge__(self, other): return _ColumnFactory()
    def __le__(self, other): return _ColumnFactory()
    def __gt__(self, other): return _ColumnFactory()
    def __lt__(self, other): return _ColumnFactory()
    def __eq__(self, other): return _ColumnFactory()
    def __ne__(self, other): return _ColumnFactory()
    def __hash__(self): return id(self)


# ---- greenlet (C extension crashes on Python 3.15) ----
_greenlet = types.ModuleType("greenlet")
_greenlet.__version__ = "3.5.5-stub"
_install_stub("greenlet", _greenlet)

# ---- structlog depends on greenlet ----
_structlog = types.ModuleType("structlog")
_structlog.get_logger = MagicMock(return_value=MagicMock())
_structlog.configure = MagicMock()
_structlog.BoundLogger = type("BoundLogger", (), {})
_install_stub("structlog", _structlog)
_install_stub("structlog.dev", types.ModuleType("structlog.dev"))
_install_stub("structlog.stdlib", types.ModuleType("structlog.stdlib"))
_install_stub("structlog.contextvars", types.ModuleType("structlog.contextvars"))
_install_stub("structlog.threadlocal", types.ModuleType("structlog.threadlocal"))

# ---- email_validator (pydantic dependency) ----
_email_validator = types.ModuleType("email_validator")
_email_validator.validate_email = MagicMock(return_value=MagicMock())
_install_stub("email_validator", _email_validator)

# ---- pydantic_settings ----
try:
    import pydantic_settings  # noqa: F401
except ImportError:
    _ps = types.ModuleType("pydantic_settings")
    _ps.BaseSettings = type("BaseSettings", (), {})
    _ps.SettingsConfigDict = lambda **kw: kw
    _ps.PydanticBaseSettingsSource = type("PydanticBaseSettingsSource", (), {})
    _install_stub("pydantic_settings", _ps)

# ---- supabase ----
_supabase = types.ModuleType("supabase")
class _FakeClient: pass
_supabase.create_client = MagicMock(return_value=_FakeClient())
_supabase.Client = _FakeClient
_install_stub("supabase", _supabase)

# ---- asyncpg ----
_asyncpg = types.ModuleType("asyncpg")
_asyncpg.Pool = MagicMock
_asyncpg.create_pool = MagicMock
_install_stub("asyncpg", _asyncpg)

# ---- bittensor ----
_bittensor = types.ModuleType("bittensor")
_bittensor.__version__ = "9.0.0-stub"
_install_stub("bittensor", _bittensor)
_install_stub("bittensor.subtensor", types.ModuleType("bittensor.subtensor"))
_install_stub("bittensor.network", types.ModuleType("bittensor.network"))

# ---- redis ----
_redis = types.ModuleType("redis")
_redis.asyncio = types.ModuleType("redis.asyncio")
_redis.asyncio.Redis = MagicMock
_redis.asyncio.from_url = MagicMock
_install_stub("redis", _redis)
_install_stub("redis.asyncio", _redis.asyncio)

# ---- starmapper ----
_install_stub("starmapper", types.ModuleType("starmapper"))

# ---- SQLAlchemy comprehensive stubs with __getattr__ fallback ----
_sa = types.ModuleType("sqlalchemy")
_sa.__version__ = "2.0-stub"
_sa.String = _ColumnFactory()
_sa.Integer = _ColumnFactory()
_sa.BigInteger = _ColumnFactory()
_sa.Float = _ColumnFactory()
_sa.Text = _ColumnFactory()
_sa.Boolean = _ColumnFactory()
_sa.DateTime = _ColumnFactory()
_sa.JSON = _ColumnFactory()
_sa.Numeric = _ColumnFactory()
_sa.Date = _ColumnFactory()
_sa.Time = _ColumnFactory()
_sa.UniqueConstraint = _ColumnFactory()
_sa.ForeignKey = _ColumnFactory()
_sa.Index = _ColumnFactory()
_sa.CheckConstraint = _ColumnFactory()
_sa.Column = _ColumnFactory()
class _FuncFactory:
    """Support func.count(), func.avg(), func.sum(), etc."""
    def __getattr__(self, name): return _ColumnFactory()
    def __call__(self, *a, **kw): return _ColumnFactory()

_sa_func = _FuncFactory()
_sa_func.now = lambda: None
_sa.func = _sa_func
_sa.select = MagicMock()
_sa.update = MagicMock()
_sa.insert = MagicMock()
_sa.and_ = lambda *a: a
_sa.text = lambda s: s
_sa.create_engine = MagicMock()
_sa.create_async_engine = MagicMock()

def _sa_getattr(name):
    return _ColumnFactory()

_sa.__getattr__ = _sa_getattr
_install_stub("sqlalchemy", _sa)

_sa_dialects = types.ModuleType("sqlalchemy.dialects")
_sa_dialects.postgresql = types.ModuleType("sqlalchemy.dialects.postgresql")
_sa_dialects.postgresql.UUID = _ColumnFactory()
_sa_dialects.postgresql.JSONB = _ColumnFactory()
_sa_dialects.postgresql.ARRAY = _ColumnFactory()
_sa_dialects.postgresql.__getattr__ = _sa_getattr
_install_stub("sqlalchemy.dialects", _sa_dialects)
_install_stub("sqlalchemy.dialects.postgresql", _sa_dialects.postgresql)

_sa_orm = types.ModuleType("sqlalchemy.orm")
_sa_orm.Mapped = _ColumnFactory()
_sa_orm.mapped_column = _ColumnFactory()
class _DeclarativeMeta(type):
    def __new__(mcs, name, bases, namespace, **kw):
        cls = super().__new__(mcs, name, bases, namespace)
        original_init = cls.__init__
        def __init__(self, *args, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
            if original_init is not object.__init__:
                original_init(self, *args, **kwargs)
        cls.__init__ = __init__
        return cls

class _DeclarativeBase(metaclass=_DeclarativeMeta):
    pass

_sa_orm.DeclarativeBase = _DeclarativeBase
_sa_orm.sessionmaker = MagicMock()
_sa_orm.relationship = MagicMock()
_sa_orm.__getattr__ = _sa_getattr
_install_stub("sqlalchemy.orm", _sa_orm)

_sa_ext = types.ModuleType("sqlalchemy.ext")
_sa_ext.__getattr__ = _sa_getattr
_install_stub("sqlalchemy.ext", _sa_ext)

_sa_async = types.ModuleType("sqlalchemy.ext.asyncio")
_sa_async.AsyncEngine = type("AsyncEngine", (), {})
_sa_async.Engine = type("Engine", (), {})
_sa_async.AsyncSession = type("AsyncSession", (), {})
_sa_async.AsyncSessionMaker = type("AsyncSessionMaker", (), {})
_sa_async.AsyncGenerator = type("AsyncGenerator", (), {})
_sa_async.create_async_engine = MagicMock()
_sa_async.create_engine = MagicMock()
_sa_async.async_sessionmaker = MagicMock()
_sa_async.__getattr__ = _sa_getattr
_install_stub("sqlalchemy.ext.asyncio", _sa_async)

_sa_pool = types.ModuleType("sqlalchemy.pool")
_sa_pool.NullPool = type("NullPool", (), {})
_sa_pool.__getattr__ = _sa_getattr
_install_stub("sqlalchemy.pool", _sa_pool)

_sa_util = types.ModuleType("sqlalchemy.util")
_sa_util.preloaded = {}
_sa_util.__getattr__ = _sa_getattr
_install_stub("sqlalchemy.util", _sa_util)
_install_stub("sqlalchemy.util.concurrency", types.ModuleType("sqlalchemy.util.concurrency"))

# ---- alembic (migrations tool, heavy) ----
_install_stub("alembic", types.ModuleType("alembic"))
_install_stub("alembic.config", types.ModuleType("alembic.config"))
_install_stub("alembic.script", types.ModuleType("alembic.script"))
