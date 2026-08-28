from logging.config import fileConfig
import os
import sys

from sqlalchemy import engine_from_config, pool

from alembic import context

# Make `app.*` importable when alembic is run from `backend/`
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Importing `app.models` registers every ORM class on Base.metadata, which
# is what autogenerate inspects. The SQL files in `database/migrations/`
# remain the source of truth for the existing schema.
from app.core.config import settings
from app.models import Base  # noqa: F401 — side effect: registers all models

# Alembic Config object
config = context.config

# Override sqlalchemy.url with our real DATABASE_URL from .env / environment
# (sync driver — env.py runs sync, even though the app uses asyncpg).
if settings.DATABASE_URL:
    sync_url = settings.database_url_sync
    config.set_main_option("sqlalchemy.url", sync_url)

# Configure Python logging from the ini file
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout without a live DB connection."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Don't try to autogenerate Postgres-specific types when offline
        render_as_batch=False,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database engine."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # Compare types so JSONB/UUID don't false-positive as drift
            compare_type=True,
            # Track column defaults too (server_default="now()" etc.)
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
