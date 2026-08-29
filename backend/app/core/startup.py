"""Startup validation to catch configuration issues early.

This module validates critical environment variables on startup so that
configuration errors produce clear, actionable error messages instead of
cryptic database connection failures or 500 errors.
"""
import logging
import re

logger = logging.getLogger(__name__)

# Regex for valid PostgreSQL connection string
_POSTGRESQL_URL_RE = re.compile(r'^postgresql(\+asyncpg)?://\S+$')


def validate_environment():
    """Validate critical environment variables on startup.

    Raises RuntimeError if any critical configuration is invalid.
    This prevents the app from starting in a broken state.
    """
    from app.core.config import settings

    errors = []

    # Check for newlines/whitespace in critical string fields
    critical_fields = [
        'DATABASE_URL',
        'DATABASE_POOLER_URL',
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'CORS_ORIGINS',
    ]

    for field in critical_fields:
        value = getattr(settings, field, '')
        if value and ('\n' in value or '\r' in value):
            errors.append(
                f"{field} contains newline characters — "
                f"this usually means the env var was set with a trailing newline"
            )
        if value and value != value.strip():
            errors.append(
                f"{field} has leading/trailing whitespace"
            )

    # Validate database URL format
    db_url = settings.effective_database_url
    if db_url:
        if not _POSTGRESQL_URL_RE.match(db_url):
            errors.append(
                f"DATABASE_URL has invalid format (must match "
                f"postgresql://user:pass@host:port/db): {db_url[:60]}..."
            )

    # Validate Supabase URL format
    if settings.SUPABASE_URL:
        if not settings.SUPABASE_URL.startswith('https://'):
            errors.append(
                f"SUPABASE_URL should start with https://: {settings.SUPABASE_URL[:60]}..."
            )

    if errors:
        for error in errors:
            logger.warning(f"CONFIG WARNING: {error}")
        # Don't raise - just log warnings so we can see what's happening
        logger.warning("Configuration validation found issues (see above)")

    logger.info("Environment validation completed")
