"""
Tests for FakeBittensorClient.

The fake client is the default in mock mode and the substrate for every
Phase 2 test that needs chain data without hitting the network. These
tests pin its deterministic contract so downstream code (DiscoveryService,
scoring) can rely on stable numbers.
"""
import sys
from datetime import datetime, timezone

import pytest

from app.clients.bittensor import FakeBittensorClient
from app.clients.snapshots import (
    EmissionSnapshot,
    IncentiveSnapshot,
    MetricsSnapshot,
    NeuronSnapshot,
    SubnetSnapshot,
)


@pytest.mark.asyncio
async def test_get_subnets_returns_three_stable_netuids():
    client = FakeBittensorClient()
    subnets = await client.get_subnets()
    assert len(subnets) == 3
    assert [s.netuid for s in subnets] == [1, 3, 64]
    assert all(isinstance(s, SubnetSnapshot) for s in subnets)
    # Names are stable so the UI/test assertions are stable.
    assert [s.name for s in subnets] == ["fake-text", "fake-vision", "fake-finetune"]
    assert all(s.is_active for s in subnets)
    assert all(s.registration_open for s in subnets)
    # Raw metadata is populated and tagged.
    assert all(s.raw_metadata.get("source") == "fake" for s in subnets)


@pytest.mark.asyncio
async def test_get_metagraph_returns_five_neurons_with_monotonic_uids():
    client = FakeBittensorClient()
    metrics, neurons = await client.get_metagraph(netuid=3)
    assert isinstance(metrics, MetricsSnapshot)
    assert metrics.netuid == 3
    assert len(neurons) == 5
    assert all(isinstance(n, NeuronSnapshot) for n in neurons)
    # UIDs are strictly increasing from 0.
    assert [n.uid for n in neurons] == [0, 1, 2, 3, 4]
    # Only the first neuron is a validator.
    assert [n.validator_permit for n in neurons] == [True, False, False, False, False]
    # Hotkeys are unique and stable per (netuid, uid).
    assert len({n.hotkey for n in neurons}) == 5


@pytest.mark.asyncio
async def test_get_emissions_is_deterministic_for_same_input():
    client = FakeBittensorClient()
    a = await client.get_emissions(netuid=1, block_range=7200)
    b = await client.get_emissions(netuid=1, block_range=7200)
    assert len(a) == len(b) == 2
    assert all(isinstance(e, EmissionSnapshot) for e in a)
    # Determinism: same input → structurally equal snapshots.
    for x, y in zip(a, b):
        assert x.netuid == y.netuid
        assert x.block == y.block
        assert x.emission_amount == y.emission_amount
    # Blocks are strictly decreasing.
    assert a[0].block > a[1].block


@pytest.mark.asyncio
async def test_now_injection_makes_snapshots_time_stable():
    fixed = datetime(2026, 1, 1, tzinfo=timezone.utc)
    client = FakeBittensorClient(_now=lambda: fixed)
    subnets = await client.get_subnets()
    metrics, _ = await client.get_metagraph(1)
    emissions = await client.get_emissions(1, 100)
    # Every snapshot's recorded_at/raw_metadata timestamp should reflect
    # the injected clock, not the wall clock.
    assert all(s.raw_metadata["seeded_at"] == fixed.isoformat() for s in subnets)
    assert metrics.recorded_at == fixed
    assert all(e.recorded_at == fixed for e in emissions)


def test_no_bittensor_import_triggered_by_loading_fake_client():
    # RealBittensorClient lazy-imports `bittensor` inside __init__.
    # Loading FakeBittensorClient must not pull that module in.
    # Save and remove bittensor from sys.modules to ensure test isolation.
    saved_bittensor = sys.modules.pop("bittensor", None)
    try:
        client = FakeBittensorClient()
        assert "bittensor" not in sys.modules
        assert isinstance(client, FakeBittensorClient)
    finally:
        if saved_bittensor is not None:
            sys.modules["bittensor"] = saved_bittensor
