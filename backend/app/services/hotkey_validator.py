from __future__ import annotations

import logging
import string
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


_BASE58_ALPHABET = set(string.digits + "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")


@dataclass
class HotkeyInfo:
    hotkey: str
    netuid: int
    uid: int | None = None
    incentive: float | None = None
    trust: float | None = None
    consensus: float | None = None
    rank: float | None = None
    emission: float | None = None
    stake: float | None = None
    active: bool | None = None
    found: bool = False
    source: str = "unknown"
    error: str | None = None
    raw: dict = field(default_factory=dict)


class HotkeyValidator:
    SS58_NETWORK_PREFIX = "5"
    SS58_MIN_LEN = 46
    SS58_MAX_LEN = 48

    def __init__(self, bittensor_client: Any = None) -> None:
        self._client = bittensor_client
        self._bt_module = None
        self._bt_checked = False

    def _ensure_bittensor(self) -> bool:
        if self._bt_checked:
            return self._bt_module is not None
        self._bt_checked = True
        try:
            import bittensor as bt
            self._bt_module = bt
            return True
        except ImportError:
            logger.warning("bittensor_sdk_unavailable_hotkey_validator_will_use_fallback")
            return False

    @staticmethod
    def validate_hotkey_format(address: str) -> bool:
        if not isinstance(address, str):
            return False
        addr = address.strip()
        if not addr.startswith("5"):
            return False
        if len(addr) < HotkeyValidator.SS58_MIN_LEN or len(addr) > HotkeyValidator.SS58_MAX_LEN:
            return False
        return all(ch in _BASE58_ALPHABET for ch in addr)

    async def validate_hotkey_onchain(
        self,
        hotkey: str,
        netuid: int,
    ) -> HotkeyInfo:
        info = HotkeyInfo(hotkey=hotkey, netuid=netuid)

        if self._client is not None:
            try:
                metrics, neurons = await self._client.get_metagraph(netuid)
            except Exception as exc:
                logger.warning("metagraph_fetch_failed", extra={"netuid": netuid, "error": str(exc)})
                info.error = f"metagraph_fetch_error: {exc}"
                info.source = "bittensor_sdk"
                if not self.validate_hotkey_format(hotkey):
                    info.error = "invalid_ss58_format"
                return info

            for neuron in neurons:
                if getattr(neuron, "hotkey", None) == hotkey:
                    info.found = True
                    info.uid = getattr(neuron, "uid", None)
                    info.incentive = getattr(neuron, "incentive", None)
                    info.trust = getattr(neuron, "trust", None)
                    info.consensus = getattr(neuron, "consensus", None)
                    info.rank = getattr(neuron, "rank", None)
                    info.emission = getattr(neuron, "emission", None)
                    info.stake = getattr(neuron, "stake", None)
                    info.active = getattr(neuron, "active", None)
                    info.source = "bittensor_sdk"
                    info.raw = {
                        "netuid": netuid,
                        "miner_count": getattr(metrics, "miner_count", None),
                    }
                    return info

            info.source = "bittensor_sdk"
            info.error = "hotkey_not_registered_in_subnet"
            if not self.validate_hotkey_format(hotkey):
                info.error = "invalid_ss58_format"
            return info

        if not self.validate_hotkey_format(hotkey):
            info.error = "invalid_ss58_format"
            info.source = "format_check"
            return info

        info.error = "bittensor_sdk_unavailable"
        info.source = "fallback"
        return info

    async def get_miner_info(
        self,
        hotkey: str,
        netuid: int,
    ) -> HotkeyInfo:
        return await self.validate_hotkey_onchain(hotkey, netuid)


_default_validator: HotkeyValidator | None = None


def get_hotkey_validator(reset: bool = False) -> HotkeyValidator:
    global _default_validator
    if reset:
        _default_validator = None
    if _default_validator is not None:
        return _default_validator
    client = None
    try:
        from app.clients.bittensor import get_bittensor_client
        client = get_bittensor_client()
    except Exception as exc:
        logger.warning("bittensor_client_init_failed", extra={"error": str(exc)})
    _default_validator = HotkeyValidator(bittensor_client=client)
    return _default_validator


def reset_hotkey_validator() -> None:
    global _default_validator
    _default_validator = None
