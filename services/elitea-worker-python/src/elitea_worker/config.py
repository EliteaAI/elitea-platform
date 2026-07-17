"""Strict local deployment selector for the not-yet-activated serve composition."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from elitea_worker.execution.errors import InvalidInput


class RuntimeDeployConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = Field(pattern=r"^elitea\.runtime-deploy\.v1$")
    workload_id: str = Field(min_length=1, max_length=256)
    redis_command_url: str = Field(min_length=1, max_length=2048)
    redis_stream: str = Field(min_length=1, max_length=512)
    redis_group: str = Field(min_length=1, max_length=256)
    redis_resp_max_bulk_bytes: int = Field(gt=0, le=48 * 1024)
    redis_max_entry_bytes: int = Field(gt=0, le=64 * 1024)
    control_target: str = Field(min_length=1, max_length=512)
    output_target: str = Field(min_length=1, max_length=512)
    content_origins: tuple[HttpUrl, ...]
    trust_bundle_path: Path
    certificate_chain_path: Path
    private_key_path: Path
    spool_path: Path
    limits_revision: str = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def validate_redis_decoder_bound(self) -> RuntimeDeployConfig:
        if self.redis_resp_max_bulk_bytes > self.redis_max_entry_bytes:
            raise ValueError("Redis RESP bulk bound cannot exceed complete entry bound")
        return self


def load_deploy_config(path: Path) -> RuntimeDeployConfig:
    try:
        raw = path.read_bytes()
        value: Any = json.loads(raw)
        return RuntimeDeployConfig.model_validate(value)
    except Exception as exc:
        raise InvalidInput("The runtime deployment configuration is invalid.") from exc
