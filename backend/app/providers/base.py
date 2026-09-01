"""
Provider abstraction for the Infranex BT deployment engine.

Every GPU provider adapter (mock, RunPod, Vast.ai, TensorDock, E2E)
implements the :class:`GPUProvider` protocol. The protocol is the
contract the deployment/approval services code against, so a new
provider drops in by implementing these six methods and registering
itself in :mod:`app.providers.registry`.

Lifecycle the protocol models:

    provision_server  ->  setup_server  ->  deploy_miner
           |                                      |
           v                                      v
    terminate_server <--- stop_miner <---(runtime)
"""
from typing import Any, Protocol, runtime_checkable

from app.models.deployment import Server


@runtime_checkable
class GPUProvider(Protocol):
    """Minimal interface every provider adapter must satisfy.

    `provision_server` is async because real providers hit the
    network to mint a server; the remaining operational methods are
    sync because they are invoked inside orchestration steps that
    already run in a worker/event-loop context.
    """

    name: str

    async def provision_server(self, deployment: Any) -> Server:
        """Create a new GPU server for `deployment`.

        Reads the snapshotted `offer` from `deployment.deployment_config`
        and returns a persisted-ready :class:`~app.models.deployment.Server`
        row (status='provisioning').
        """
        ...

    def setup_server(self, server: Server) -> bool:
        """Install runtime deps (docker, nvidia stack) on the server.

        Returns ``True`` on success.
        """
        ...

    def deploy_miner(self, server: Server, config: dict[str, Any]) -> bool:
        """Launch the miner process on `server` using `config`.

        Returns ``True`` on success.
        """
        ...

    def stop_miner(self, server: Server) -> bool:
        """Stop the running miner on `server`.

        Returns ``True`` on success.
        """
        ...

    def terminate_server(self, server: Server) -> bool:
        """Destroy/terminate `server` and release the GPU.

        Returns ``True`` on success.
        """
        ...

    def get_status(self, server: Server) -> dict[str, Any]:
        """Return a provider-specific status dict for `server`."""
        ...


class ProductionProvider:
    """Placeholder for an unimplemented real adapter.

    Real providers (RunPod, Vast.ai, TensorDock, E2E) implement the
    same :class:`GPUProvider` shape and register themselves in
    :mod:`app.providers.registry`. This stub exists so the registry
    keeps a stable `production` key and fails loudly instead of
    silently doing nothing when a provider hasn't been wired up yet.
    """

    name = "production"

    async def provision_server(self, deployment: Any) -> Server:
        raise NotImplementedError("Real provider adapter not yet implemented")

    def setup_server(self, server: Server) -> bool:
        raise NotImplementedError("Real provider adapter not yet implemented")

    def deploy_miner(self, server: Server, config: dict[str, Any]) -> bool:
        raise NotImplementedError("Real provider adapter not yet implemented")

    def stop_miner(self, server: Server) -> bool:
        raise NotImplementedError("Real provider adapter not yet implemented")

    def terminate_server(self, server: Server) -> bool:
        raise NotImplementedError("Real provider adapter not yet implemented")

    def get_status(self, server: Server) -> dict[str, Any]:
        raise NotImplementedError("Real provider adapter not yet implemented")


def offer_from_deployment(deployment: Any) -> dict[str, Any]:
    """Pull the snapshotted `offer` out of a Deployment's config.

    The request stage writes ``deployment_config["offer"]`` so the
    provision step can build a server without re-fetching the ranking.
    """
    config = getattr(deployment, "deployment_config", None) or {}
    return config.get("offer", {}) or {}
