import asyncio
import os
import sys

with open('.vercel/.env.development.local', 'r') as f:
    for line in f:
        if line.strip() and not line.startswith('#'):
            key, val = line.strip().split('=', 1)
            os.environ[key] = val.strip('\"')

sys.path.insert(0, os.path.abspath('backend'))

from app.core.database import db_manager
from app.monitoring.aggregator import MonitoringAggregator

async def test():
    try:
        async with db_manager.get_async_session() as db:
            aggregator = MonitoringAggregator(db)
            overview = await aggregator.get_system_overview()
            print('Success!', overview)
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(test())
