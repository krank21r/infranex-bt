"""
GPU catalog and provider schemas.
"""
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import Field

from app.schemas.common import BaseSchema, IDMixin, TimestampMixin


class GPUModel(BaseSchema, IDMixin, TimestampMixin):
    """GPU model specification."""
    name: str = Field(description="GPU model name (e.g., H100, A100, RTX 4090)")
    vendor: str = Field(description="GPU vendor (NVIDIA, AMD, Intel)")
    architecture: str | None = Field(default=None, description="GPU architecture")

    # Memory
    vram_gb: int = Field(description="VRAM in GB")
    memory_type: str | None = Field(default=None, description="Memory type (HBM3, GDDR6X, etc.)")
    memory_bandwidth_gbps: int | None = Field(default=None, description="Memory bandwidth GB/s")

    # Compute
    fp32_tflops: Decimal | None = Field(default=None, description="FP32 TFLOPS")
    fp16_tflops: Decimal | None = Field(default=None, description="FP16/BF16 TFLOPS")
    tensor_core_tflops: Decimal | None = Field(default=None, description="Tensor core TFLOPS")

    # Power
    tdp_watts: int | None = Field(default=None, description="Thermal design power in watts")

    # Form factor
    form_factor: str | None = Field(default=None, description="Form factor (PCIe, SXM, etc.)")
    slot_width: float | None = Field(default=None, description="Slot width")

    # Pricing (reference)
    msrp_usd: Decimal | None = Field(default=None, description="MSRP in USD")
    current_market_price_usd: Decimal | None = Field(default=None, description="Current market price")

    # Metadata
    release_date: datetime | None = Field(default=None, description="Release date")
    is_datacenter: bool = Field(default=False, description="Whether datacenter grade")
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GPUProvider(BaseSchema, IDMixin, TimestampMixin):
    """GPU cloud provider."""
    name: str = Field(description="Provider name")
    display_name: str = Field(description="Display name")
    website: str = Field(description="Provider website")
    logo_url: str | None = Field(default=None, description="Logo URL")

    # Coverage
    regions: list[str] = Field(default_factory=list, description="Available regions")
    availability_zones: list[str] = Field(default_factory=list)

    # Features
    supports_spot: bool = Field(default=False, description="Supports spot/preemptible instances")
    supports_reserved: bool = Field(default=False, description="Supports reserved instances")
    supports_persistent: bool = Field(default=True, description="Supports persistent instances")

    # Billing
    billing_increment_seconds: int = Field(default=60, description="Billing increment in seconds")
    minimum_charge_seconds: int = Field(default=60, description="Minimum charge in seconds")

    # API
    api_docs_url: str | None = Field(default=None, description="API documentation URL")
    has_api: bool = Field(default=True, description="Has public API")

    # Status
    is_active: bool = Field(default=True)
    reliability_score: Decimal | None = Field(default=None, ge=0, le=100)

    metadata: dict[str, Any] = Field(default_factory=dict)


class GPUOffer(BaseSchema, IDMixin, TimestampMixin):
    """GPU instance offer from a provider."""
    provider_id: str
    provider_name: str
    gpu_model_id: str
    gpu_model_name: str
    gpu_vendor: str
    gpu_vram_gb: int

    # Instance config
    instance_type: str = Field(description="Provider's instance type name")
    gpu_count: int = Field(default=1, description="Number of GPUs")
    vcpu_count: int | None = Field(default=None, description="vCPU count")
    memory_gb: int | None = Field(default=None, description="System memory GB")
    storage_gb: int | None = Field(default=None, description="Local storage GB")
    network_gbps: Decimal | None = Field(default=None, description="Network bandwidth Gbps")

    # Pricing
    price_per_hour_usd: Decimal = Field(description="On-demand price per hour USD")
    price_per_hour_inr: Decimal | None = Field(default=None, description="Price per hour INR")
    spot_price_per_hour_usd: Decimal | None = Field(default=None, description="Spot price per hour USD")
    spot_price_per_hour_inr: Decimal | None = Field(default=None, description="Spot price per hour INR")
    reserved_price_per_hour_usd: Decimal | None = Field(default=None, description="Reserved price per hour USD")

    # Availability
    region: str = Field(description="Region code")
    availability_zone: str | None = Field(default=None)
    is_available: bool = Field(default=True, description="Currently available")
    quantity_available: int | None = Field(default=None, description="Available quantity")

    # Features
    is_spot: bool = Field(default=False)
    is_reserved: bool = Field(default=False)
    contract_term_months: int | None = Field(default=None, description="Reserved contract term")

    # Metadata
    last_updated: datetime = Field(description="Last price update")
    metadata: dict[str, Any] = Field(default_factory=dict)


class GPUOfferListResponse(BaseSchema):
    """Paginated GPU offer list response."""
    items: list[GPUOffer]
    meta: 'PaginationMeta'


class GPUFilterParams(BaseSchema):
    """Filter parameters for GPU queries."""
    vendor: str | None = None
    min_vram_gb: int | None = None
    max_vram_gb: int | None = None
    min_fp16_tflops: Decimal | None = None
    is_datacenter: bool | None = None


class GPUOfferFilterParams(BaseSchema):
    """Filter parameters for GPU offer queries."""
    provider_id: str | None = None
    gpu_model_id: str | None = None
    gpu_vendor: str | None = None
    min_vram_gb: int | None = None
    max_vram_gb: int | None = None
    region: str | None = None
    is_spot: bool | None = None
    max_price_per_hour_usd: Decimal | None = None
    is_available: bool | None = True


class GPUOfferSortParams(BaseSchema):
    """Sort parameters for GPU offer queries."""
    sort_by: str = Field(default="price_per_hour_usd", description="Field to sort by")
    sort_order: str = Field(default="asc", pattern="^(asc|desc)$")


# Rebuild with forward reference
from app.schemas.common import PaginationMeta

GPUOfferListResponse.model_rebuild()
