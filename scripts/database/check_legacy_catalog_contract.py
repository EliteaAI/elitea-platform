#!/usr/bin/env python3
"""Fail when checked-in live schema evidence no longer matches coded assumptions."""

from __future__ import annotations

import json
from pathlib import Path


CATALOG_PATH = Path("testdata/postgres/legacy-centry-catalog.json")
RBAC_PATH = Path("testdata/postgres/legacy-rbac-matrix.json")


def table(catalog: dict, schema_name: str, table_name: str) -> dict:
    for schema in catalog["catalog"]["schemas"]:
        if schema["name"] != schema_name:
            continue
        for candidate in schema["tables"]:
            if candidate["name"] == table_name:
                return candidate
    raise AssertionError(f"missing live table evidence: {schema_name}.{table_name}")


def shape(table_document: dict) -> list[tuple[str, str, bool]]:
    return [
        (column["name"], column["data_type"], column["nullable"])
        for column in table_document["columns"]
    ]


CONFIGURATION_SHAPE = [
    ("id", "integer", False),
    ("uuid", "uuid", False),
    ("project_id", "integer", False),
    ("label", "character varying", True),
    ("elitea_title", "character varying", False),
    ("type", "character varying", False),
    ("section", "character varying", False),
    ("data", "jsonb", False),
    ("meta", "jsonb", False),
    ("shared", "boolean", False),
    ("status_ok", "boolean", False),
    ("status_logs", "text", True),
    ("source", "character varying", False),
    ("author_id", "integer", True),
    ("created_at", "timestamp without time zone", False),
    ("updated_at", "timestamp without time zone", True),
]

TOKEN_SHAPE = [
    ("id", "integer", False),
    ("uuid", "character varying(36)", True),
    ("expires", "timestamp without time zone", True),
    ("user_id", "integer", True),
    ("name", "text", True),
]

USER_SHAPE = [
    ("id", "integer", False),
    ("email", "text", True),
    ("name", "text", True),
    ("last_login", "timestamp without time zone", True),
    ("suspended", "boolean", False),
]

AUTH_TABLE_SHAPES = {
    "auth_core__group": [
        ("id", "integer", False),
        ("parent_id", "integer", True),
        ("name", "text", True),
    ],
    "auth_core__group_permission": [
        ("group_id", "integer", False),
        ("scope_id", "integer", False),
        ("permission", "text", False),
    ],
    "auth_core__group_provider": [
        ("group_id", "integer", False),
        ("provider_ref", "text", False),
    ],
    "auth_core__project_role": [
        ("id", "integer", False),
        ("project_id", "integer", False),
        ("name", "text", False),
    ],
    "auth_core__project_role_permission": [
        ("id", "integer", False),
        ("project_id", "integer", False),
        ("role_id", "integer", True),
        ("permission", "text", False),
    ],
    "auth_core__project_user_role": [
        ("id", "integer", False),
        ("project_id", "integer", False),
        ("user_id", "integer", True),
        ("role_id", "integer", True),
    ],
    "auth_core__role": [
        ("id", "integer", False),
        ("name", "character varying(64)", False),
        ("mode", "character varying(64)", False),
    ],
    "auth_core__role_permission": [
        ("id", "integer", False),
        ("role_id", "integer", False),
        ("permission", "character varying(64)", True),
    ],
    "auth_core__scope": [
        ("id", "integer", False),
        ("parent_id", "integer", True),
        ("name", "text", True),
    ],
    "auth_core__token": TOKEN_SHAPE,
    "auth_core__user": USER_SHAPE,
    "auth_core__user_group": [
        ("user_id", "integer", False),
        ("group_id", "integer", False),
    ],
    "auth_core__user_permission": [
        ("user_id", "integer", False),
        ("scope_id", "integer", False),
        ("permission", "text", False),
    ],
    "auth_core__user_provider": [
        ("user_id", "integer", False),
        ("provider_ref", "text", False),
    ],
    "auth_core__user_role": [
        ("id", "integer", False),
        ("user_id", "integer", False),
        ("role_id", "integer", False),
    ],
}

PROJECT_SHAPE = [
    ("id", "integer", False),
    ("name", "character varying(256)", False),
    ("owner_id", "integer", False),
    ("secrets_json", "json", True),
    ("plugins", "text[]", True),
    ("keycloak_groups", "json", False),
    ("create_success", "boolean", False),
    ("suspended", "boolean", False),
]


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    rbac = json.loads(RBAC_PATH.read_text(encoding="utf-8"))
    assert catalog["source"]["server_version_num"] == "180002"
    assert catalog["source"]["database_timezone"] == "Etc/UTC"
    assert rbac["source"]["database_timezone"] == "Etc/UTC"

    p1 = table(catalog, "p_1", "configuration")
    p2 = table(catalog, "p_2", "configuration")
    assert shape(p1) == CONFIGURATION_SHAPE
    assert shape(p2) == CONFIGURATION_SHAPE
    for table_name, expected_shape in AUTH_TABLE_SHAPES.items():
        assert shape(table(catalog, "public", table_name)) == expected_shape
    assert shape(table(catalog, "centry", "project")) == PROJECT_SHAPE

    for relation in (p1, p2):
        assert relation["row_security_enabled"] is False
        assert relation["row_security_forced"] is False
        assert relation["row_security_policies"] == []
        assert relation["triggers"] == []
        assert {index["name"] for index in relation["indexes"]} == {
            "configuration_elitea_title_key",
            "configuration_pkey",
            "configuration_uuid_key",
        }

    print(
        json.dumps(
            {
                "postgresql_server_version_num": "180002",
                "database_timezone": "Etc/UTC",
                "configuration_schemas": ["p_1", "p_2"],
                "configuration_columns": len(CONFIGURATION_SHAPE),
                "auth_tables_checked": sorted(AUTH_TABLE_SHAPES),
                "project_lifecycle_columns_checked": ["create_success", "suspended"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
