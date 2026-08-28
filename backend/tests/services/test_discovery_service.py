"""
Tests for DiscoveryService.

These tests stub out SubnetService entirely (no DB) and drive the
orchestrator with the real FakeBittensorClient. The contract being
pinned: per-step call counts, error-surfacing in the result dict, and
correct data_source tagging based on which client was injected.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.clients.bittensor import FakeBittensorClient
from app.services.discovery_service import DiscoveryService, DATA_SOURCE_FAKE


def _make_service(client=None):
    """Build a DiscoveryService with a stubbed SubnetService.

    The real DiscoveryService constructs a SubnetService(db) in __init__,
    but we replace it with a MagicMock so no DB is touched.
    """
    if client is None:
        client = FakeBittensorClient()
    service = DiscoveryService(db=MagicMock(), client=client)
    service.subnets = MagicMock()
    service.subnets.upsert = AsyncMock(return_value=MagicMock())
    service.subnets.append_metrics_history = AsyncMock(return_value=MagicMock())
    service.subnets.upsert_neuron = AsyncMock(return_value=MagicMock())
    service.subnets.get_known_netuids = AsyncMock(return_value=[1, 3, 64])
    service.subnets.append_emission = AsyncMock(return_value=MagicMock())
    service.subnets.append_incentive = AsyncMock(return_value=MagicMock())
    return service


@pytest.mark.asyncio
async def test_sync_subnets_calls_client_once_and_upserts_each():
    service = _make_service()
    count = await service.sync_subnets()
    assert count == 3
    assert service.subnets.upsert.await_count == 3
    netuids_upserted = [
        call.kwargs["netuid"] for call in service.subnets.upsert.await_args_list
    ]
    assert netuids_upserted == [1, 3, 64]


@pytest.mark.asyncio
async def test_sync_metrics_writes_one_metrics_row_and_five_neuron_rows():
    service = _make_service()
    count = await service.sync_metrics(netuid=1)
    assert count == 5
    service.subnets.append_metrics_history.assert_awaited_once()
    assert service.subnets.append_metrics_history.await_args.kwargs["netuid"] == 1
    assert (
        service.subnets.append_metrics_history.await_args.kwargs["data_source"]
        == DATA_SOURCE_FAKE
    )
    assert service.subnets.upsert_neuron.await_count == 5
    for call in service.subnets.upsert_neuron.await_args_list:
        assert call.kwargs["netuid"] == 1


@pytest.mark.asyncio
async def test_run_full_scan_aggregates_counts_and_surfaces_errors():
    service = _make_service()
    result = await service.run_full_scan()
    assert result["subnets"] == 3
    assert result["metrics"] == {1: 5, 3: 5, 64: 5}
    assert result["neurons"] == 15
    assert result["emissions"] == 6
    # get_incentives emits 2 blocks x 5 neurons per subnet = 10 per
    # subnet, 30 across the 3 fake subnets.
    assert result["incentives"] == 30
    assert result["errors"] == []
    assert result["source"] == DATA_SOURCE_FAKE


@pytest.mark.asyncio
async def test_run_full_scan_swallows_per_step_errors():
    service = _make_service()
    real_get_emissions = service.client.get_emissions

    async def flaky_get_emissions(netuid, block_range):
        if netuid == 3:
            raise RuntimeError("simulated RPC failure")
        return await real_get_emissions(netuid, block_range)

    service.client.get_emissions = flaky_get_emissions

    result = await service.run_full_scan()
    assert "errors" in result
    assert any("sync_emissions" in e for e in result["errors"])
    assert 0 < result["emissions"] < 6


@pytest.mark.asyncio
async def test_data_source_is_fake_when_using_fake_client():
    service = _make_service()
    assert service._data_source == DATA_SOURCE_FAKE
    await service.sync_subnets()
    assert service.subnets.upsert.await_count == 3
    for call in service.subnets.upsert.await_args_list:
        assert "name" in call.kwargs
