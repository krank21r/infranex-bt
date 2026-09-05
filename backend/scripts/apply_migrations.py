"""
Apply database migrations to Supabase via transaction pooler.
"""
import asyncio
import os
import sys
from pathlib import Path

import asyncpg

# Connection details supplied by user
POOLER_DSN = "postgresql://postgres.xwpahwecneudzoklxumg:xkbjtQuTTHFLR9Bg@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
MIGRATIONS_DIR = Path(r"D:\Infranex BT\infranex-bt\database\migrations")


async def main() -> int:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("No migration files found")
        return 1

    print(f"Connecting to: {POOLER_DSN.split('@')[-1]}")
    # Disable statement cache (required for PgBouncer transaction pooler)
    conn = await asyncpg.connect(POOLER_DSN, statement_cache_size=0)
    try:
        for f in files:
            sql = f.read_text(encoding="utf-8")
            print(f"\n=== Applying {f.name} ({len(sql)} chars) ===")
            try:
                await conn.execute(sql)
                print(f"OK: {f.name}")
            except Exception as e:
                # Some migrations use multi-statement features; if it fails,
                # try splitting on semicolons at end of line (simple heuristic)
                print(f"FAIL on {f.name}: {e}")
                # try statement-by-statement fallback
                try:
                    stmts = [s.strip() for s in sql.split(";\n") if s.strip()]
                    for i, stmt in enumerate(stmts):
                        if not stmt:
                            continue
                        try:
                            await conn.execute(stmt)
                        except Exception as e2:
                            print(f"  stmt {i+1}/{len(stmts)}: {e2}")
                            print(f"  >> {stmt[:120]!r}")
                    print(f"PARTIAL: {f.name}")
                except Exception as e3:
                    print(f"FATAL split: {e3}")
                    return 2
        # Verify tables
        rows = await conn.fetch(
            "select tablename from pg_tables where schemaname='public' order by tablename"
        )
        print("\n=== Public tables now present ===")
        for r in rows:
            print(f"  - {r['tablename']}")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
