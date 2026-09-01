from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.gpu_engine.config_writer import (
    chmod_executable,
    write_env_file,
    write_miner_config,
    write_startup_script,
)
from app.gpu_engine.cuda_installer import (
    install_cuda_driver,
    install_nvidia_driver,
    verify_cuda_installation,
)
from app.gpu_engine.dependency_installer import (
    install_bittensor,
    install_python_deps,
    install_subnet_deps,
    verify_installation,
)
from app.gpu_engine.docker_installer import (
    configure_docker_daemon,
    install_docker,
    install_nvidia_container_toolkit,
    verify_docker_gpu,
)
from app.gpu_engine.model_downloader import (
    download_model,
    verify_model_checksum,
)
from app.gpu_engine.models import (
    InstallationResult,
    InstallationStep,
    ServerSpec,
)


class GPUInstaller:
    """Installation orchestrator that runs the full GPU setup pipeline."""

    PIPELINE = [
        ("cuda", install_cuda_driver, ["target_version"]),
        ("nvidia_driver", install_nvidia_driver, []),
        ("verify_cuda", verify_cuda_installation, []),
        ("docker", install_docker, []),
        ("nvidia_toolkit", install_nvidia_container_toolkit, []),
        ("verify_docker_gpu", verify_docker_gpu, []),
        ("configure_docker_daemon", configure_docker_daemon, []),
        ("python_deps", install_python_deps, ["requirements_txt_url"]),
        ("install_bittensor", install_bittensor, []),
        ("install_subnet_deps", install_subnet_deps, ["netuid", "repo_url"]),
        ("verify_python_deps", verify_installation, ["package"]),
        ("download_models", download_model, ["model_url", "target_path"]),
        ("verify_model_checksum", verify_model_checksum, ["file_path", "expected_sha256"]),
        ("write_config", write_miner_config, ["config"]),
        ("write_env", write_env_file, ["env_vars"]),
        ("write_startup", write_startup_script, ["script_content", "path"]),
        ("make_executable", chmod_executable, ["path"]),
    ]

    def __init__(self, ssh: Any, server_spec: ServerSpec, mock: bool = False) -> None:
        self.ssh = ssh
        self.server_spec = server_spec
        self.mock = mock
        self.steps: list[InstallationStep] = []
        self._installed_components: list[str] = []

    async def install_all(self) -> InstallationResult:
        """Run the full setup pipeline. Returns InstallationResult with step statuses."""
        self.steps = []
        self._installed_components = []
        start_total = datetime.now(UTC)

        for step_name, step_func, required_params in self.PIPELINE:
            step = InstallationStep(name=step_name)
            self.steps.append(step)

            # Get parameter values
            params = {}
            for param in required_params:
                if hasattr(self.server_spec, param):
                    params[param] = getattr(self.server_spec, param)
                elif param in ["requirements_txt_url", "model_url", "target_path", "netuid", "repo_url", "config", "env_vars", "script_content", "path"]:
                    # These would come from context in real usage; for mock use defaults
                    params[param] = f"mock_{param}"

            step.start()
            try:
                # Handle special cases for functions that need ssh parameter
                func_kwargs = {param: params[param] for param in required_params}
                # Add ssh to kwargs
                func_kwargs["ssh"] = self.ssh

                result = await step_func(**func_kwargs)

                if result.success if hasattr(result, 'success') else True:
                    step.success(output=str(result))
                    # Track installed components
                    if step_name == "cuda":
                        self._installed_components.append("cuda")
                    elif step_name == "nvidia_driver":
                        self._installed_components.append("nvidia_driver")
                    elif step_name in ("docker", "nvidia_toolkit", "configure_docker_daemon"):
                        self._installed_components.append("docker")
                    elif step_name == "python_deps":
                        self._installed_components.append("python_deps")
                    elif step_name == "install_bittensor":
                        self._installed_components.append("bittensor")
                    elif step_name.startswith("install_subnet"):
                        self._installed_components.append("subnet_deps")
                    elif step_name == "download_models":
                        self._installed_components.append("models")
                    elif step_name == "write_config":
                        self._installed_components.append("config")
                    elif step_name == "write_env":
                        self._installed_components.append("env")
                    elif step_name == "write_startup":
                        self._installed_components.append("startup_script")
                    elif step_name == "make_executable":
                        self._installed_components.append("executable_perms")
                else:
                    step.fail(error=getattr(result, 'error', 'Unknown failure'))
                    return await self._rollback(step)

            except Exception as e:
                step.fail(error=str(e))
                return await self._rollback(step)

        total_duration = (datetime.now(UTC) - start_total).total_seconds()
        return InstallationResult(
            success=True,
            steps=self.steps,
            total_duration_seconds=total_duration,
        )

    async def _rollback(self, failed_step: InstallationStep) -> InstallationResult:
        """Rollback: uninstall what was installed before the failure."""
        start = datetime.now(UTC)
        rollback_errors: list[str] = []

        # Rollback in reverse order (last installed first)
        for component in reversed(self._installed_components):
            try:
                if component == "cuda":
                    # Remove cuda installation
                    await self.ssh.exec_command("apt-get remove -y cuda-toolkit-12-2")
                elif component == "nvidia_driver":
                    await self.ssh.exec_command("apt-get remove -y nvidia-driver-535")
                elif component == "docker":
                    await self.ssh.exec_command("apt-get remove -y docker-ce")
                elif component == "bittensor":
                    await self.ssh.exec_command("pip uninstall -y bittensor")
                elif component == "subnet_deps":
                    await self.ssh.exec_command("rm -rf /opt/subnet")
                elif component == "models":
                    await self.ssh.exec_command("rm -rf /models")
                elif component == "config":
                    await self.ssh.exec_command("rm -f /opt/miner/config.json")
                elif component == "env":
                    await self.ssh.exec_command("rm -f /opt/miner/.env")
                elif component == "startup_script":
                    await self.ssh.exec_command("rm -f /opt/miner/start.sh")
                elif component == "executable_perms":
                    pass  # permissions don't need rolling back
            except Exception as e:
                rollback_errors.append(f"{component}: {e!s}")

        (datetime.now(UTC) - start).total_seconds()
        all_errors = [step.error or "" for step in self.steps if step.error]
        all_errors.extend(rollback_errors)

        total_duration = (datetime.now(UTC) - start).total_seconds()

        return InstallationResult(
            success=False,
            steps=self.steps,
            total_duration_seconds=total_duration,
            error="; ".join(all_errors) if all_errors else None,
        )
