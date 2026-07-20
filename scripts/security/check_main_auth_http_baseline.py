#!/usr/bin/env python3
"""Validate the bounded checked-in pylon_main Auth HTTP evidence fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


EXPECTED_CONTRACT_IDS = [
    "current_user.get",
    "framework.head_via_get",
    "framework.merge_slashes.redirect",
    "framework.options.cors",
    "inherited.empty_mode_handlers.404",
    "pat.collection.delete",
    "pat.collection.get",
    "pat.collection.post",
    "pat.item.delete",
    "pat.item.get",
    "pat.item.post",
    "rbac.permissions.get",
]
TOKEN_COLLECTION_ROUTES = ["/api/v2/auth/token/"]
TOKEN_REGISTERED_COLLECTION_ROUTES = [
    "/api/v2/auth/token/",
    "/api/v2/auth/token//",
]
TOKEN_ITEM_ROUTES = [
    "/api/v2/auth/token/<string:uid>",
    "/api/v2/auth/token/<string:uid>/",
]
USER_ROUTES = [
    "/api/v2/auth/user/<string:mode>",
    "/api/v2/auth/user/<string:mode>/",
    "/api/v2/auth/user/",
]
USER_REGISTERED_ROUTES = USER_ROUTES + ["/api/v2/auth/user//"]
PERMISSION_ROUTES = [
    "/api/v2/auth/permissions/<string:mode>/<int:project_id>",
    "/api/v2/auth/permissions/<string:mode>/<int:project_id>/",
]


def _expected_canonicalization_matrix() -> dict[str, dict[str, Any]]:
    targets = {
        "/api/v2/auth/token//": "/api/v2/auth/token/",
        "/api/v2/auth/user//": "/api/v2/auth/user/",
    }
    return {
        route: {
            "canonical_location_path": target,
            "methods": {
                method: {
                    "contract_id": "framework.merge_slashes.redirect",
                    "status": 308,
                }
                for method in ("DELETE", "GET", "HEAD", "PATCH", "POST", "PUT")
            }
            | {
                "OPTIONS": {
                    "contract_id": "framework.options.cors",
                    "redirect_response_replaced_by_auth_after_request": True,
                    "status": 200,
                }
            },
        }
        for route, target in targets.items()
    }


def _expected_matrix() -> dict[str, dict[str, str]]:
    matrix: dict[str, dict[str, str]] = {}
    for route in TOKEN_COLLECTION_ROUTES:
        matrix[route] = {
            "DELETE": "pat.collection.delete",
            "GET": "pat.collection.get",
            "HEAD": "framework.head_via_get",
            "OPTIONS": "framework.options.cors",
            "PATCH": "inherited.empty_mode_handlers.404",
            "POST": "pat.collection.post",
            "PUT": "inherited.empty_mode_handlers.404",
        }
    for route in TOKEN_ITEM_ROUTES:
        matrix[route] = {
            "DELETE": "pat.item.delete",
            "GET": "pat.item.get",
            "HEAD": "framework.head_via_get",
            "OPTIONS": "framework.options.cors",
            "PATCH": "inherited.empty_mode_handlers.404",
            "POST": "pat.item.post",
            "PUT": "inherited.empty_mode_handlers.404",
        }
    for route in USER_ROUTES:
        matrix[route] = {
            "DELETE": "inherited.empty_mode_handlers.404",
            "GET": "current_user.get",
            "HEAD": "framework.head_via_get",
            "OPTIONS": "framework.options.cors",
            "PATCH": "inherited.empty_mode_handlers.404",
            "POST": "inherited.empty_mode_handlers.404",
            "PUT": "inherited.empty_mode_handlers.404",
        }
    for route in PERMISSION_ROUTES:
        matrix[route] = {
            "GET": "rbac.permissions.get",
            "HEAD": "framework.head_via_get",
            "OPTIONS": "framework.options.cors",
        }
    return matrix


EXPECTED_METHOD_ROUTE_MATRIX = _expected_matrix()
EXPECTED_RESOURCE_METHODS = {
    "permissions": {
        "direct_handler_methods": ["GET"],
        "effective_handler_methods": ["GET"],
        "exposed_http_methods": ["GET", "HEAD", "OPTIONS"],
        "framework_generated_methods": ["HEAD", "OPTIONS"],
        "handler_routes": PERMISSION_ROUTES,
        "inherited_handler_methods": [],
        "registered_routes": PERMISSION_ROUTES,
        "resource_base": "Resource",
    },
    "token": {
        "direct_handler_methods": ["DELETE", "GET", "POST"],
        "effective_handler_methods": ["DELETE", "GET", "PATCH", "POST", "PUT"],
        "exposed_http_methods": [
            "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT",
        ],
        "framework_generated_methods": ["HEAD", "OPTIONS"],
        "handler_routes": TOKEN_COLLECTION_ROUTES + TOKEN_ITEM_ROUTES,
        "inherited_handler_methods": ["PATCH", "PUT"],
        "registered_routes": TOKEN_REGISTERED_COLLECTION_ROUTES + TOKEN_ITEM_ROUTES,
        "resource_base": "api_tools.APIBase",
    },
    "user": {
        "direct_handler_methods": ["GET"],
        "effective_handler_methods": ["DELETE", "GET", "PATCH", "POST", "PUT"],
        "exposed_http_methods": [
            "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT",
        ],
        "framework_generated_methods": ["HEAD", "OPTIONS"],
        "handler_routes": USER_ROUTES,
        "inherited_handler_methods": ["DELETE", "PATCH", "POST", "PUT"],
        "registered_routes": USER_REGISTERED_ROUTES,
        "resource_base": "api_tools.APIBase",
    },
}
EXPECTED_SOURCE_HASHES = {
    "auth/api/v2/permissions.py": "77c99e5a47c0afb481a85217d5bd6f839b744c58eb536236e3cbb6d913c5771a",
    "auth/api/v2/token.py": "a906641b19a1ee249f84149515aba6290bac5ff46e80866bdfed9f24c7e41536",
    "auth/api/v2/user.py": "8663790b7f2dfea38c38a087ad23784c037cf52d01d649f5fa8ee9d03ff7a90f",
    "auth/config.yml": "928c61804d6333e7539e6d4f407bf1d5e5cc9677fc744eb0e6801a865f437d7a",
    "auth/module.py": "43893335919d184c2ea1ba3f84957a6fbebb1b5028dd0e979eff1b542fa2da46",
    "auth/rpc/user.py": "883d69c07ddba0545b6970b8b82cdb2e9b9ba910cfa8582431f0908891dc384c",
    "auth_core/config.yml": "2775b6b05d0d00eeb3d63a3b2a833deb5c755622a55a4674364eeff86e28bfd1",
    "auth_core/db/db_tools.py": "17ebb8e74decb981c85f9d3b872e510ed941edb958a58fbebc1cb725da18f352",
    "auth_core/db/migrations/202202021633_core.py": "0bf300d959432a51ede0de4d4040fa3c8e5989c6f4148944a17462a2562769e3",
    "auth_core/methods/auth_context.py": "2de980256c76022162651a7e2592117fc7796e8a4861d9baebbae95dfd8149be",
    "auth_core/module.py": "86f7f99cce01b4a4bb92c7e3a1640ea1781ab2448a19fce66e6f4de48a8d4b39",
    "auth_core/requirements.txt": "c67a55a6cbac7a7fde460b6ef9e25cd0483400a12b7f0b6a8d0d658a93a4849b",
    "auth_core/rpc/auth_context.py": "89a0b234c1d383c86d8b565d11607b2254920838c5b73d9a4bc6b83bdcd93cec",
    "auth_core/rpc/tokens.py": "0bdb68a1631f1b150a87441ca2fdcf85e3b9a0696ebe701b552043a0661fb7b0",
    "auth_core/rpc/users.py": "3df51e92b88d51d02a389b6460d38fe5837798f475311090988f9204565a186e",
    "auth_core/tools/rpc_tools.py": "ceb58dd5b91740f7e80e71ecce0561faeeda6a4fc78f03e2fc11ddbbe23c2023",
    "centry/pylon_auth/configs/auth_core.yml": "3ad4d4a119538b66c0e7e6308945ed08c33d43d7046127ad64fb39a547062f6c",
    "centry/pylon_main/configs/auth.yml": "fb7c35f0d19eae7b5da5d8444a9a3524934572706eb701855c804eb3e52a7fc5",
    "projects/rpc/poc.py": "84b238686d4099d6462ea8f28b1e1e807e5de71b8502f92a9caedf4d28d43336",
    "pylon/pylon/core/tools/dict.py": "4f3f332c898b9edfcee4eb79a31c88c5d5363730b72060865616be9bf1ac6815",
    "pylon/pylon/core/tools/module/descriptor.py": "021fb237ff254cb54ca91aa40dc4080b1a573468030066329f862f525f0d8a22",
    "pylon/requirements.txt": "17b66334289a5f6329491fb512fcce35587349734b7885dcab8c592fdbe4ed57",
    "shared/module.py": "a18c99d92e5c2f9fca41fd49c817b31eae48e357ad928d3973f9cbf4014f3e61",
    "shared/tools/api_tools.py": "cc85b81aa0d2d022f382b616ac453ea5dd6cdc8bee09b43ec031c1b325127cdf",
    "shared/tools/config.py": "7eba3bab4443f7ddaaf027d4e3bcee327d59a5a1763bdbaa8fa43e70d669ad7b",
}
EXPECTED_FINGERPRINT_KEYS = {
    "api/v2/permissions.py#API.get",
    "api/v2/token.py#API.delete",
    "api/v2/token.py#API.get",
    "api/v2/token.py#API.post",
    "api/v2/user.py#API.get",
    "auth_core/db/db_tools.py#sqlalchemy_mapping_to_dict",
    "auth_core/methods/auth_context.py#Method.get_auth_context",
    "auth_core/module.py#Module.__init__",
    "auth_core/module.py#Module.init",
    "auth_core/rpc/auth_context.py#RPC.get_referenced_auth_context",
    "auth_core/rpc/tokens.py#RPC.add_token",
    "auth_core/rpc/tokens.py#RPC.encode_token",
    "auth_core/rpc/users.py#RPC.get_user",
    "auth_core/tools/rpc_tools.py#wrap_exceptions",
    "module.py#Module._after_request_hook",
    "module.py#Module._before_request_hook",
    "module.py#Module.access_denied_reply",
    "module.py#Module.resolve_permissions",
    "pylon/core/tools/dict.py#recursive_merge",
    "pylon/core/tools/module/descriptor.py#ModuleDescriptor.init_api",
    "pylon/core/tools/module/descriptor.py#ModuleDescriptor.load_config",
    "projects/rpc/poc.py#RPC.get_personal_project_id",
    "rpc/user.py#RPC.current_user",
    "shared/tools/api_tools.py#APIBase.delete",
    "shared/tools/api_tools.py#APIBase.get",
    "shared/tools/api_tools.py#APIBase.patch",
    "shared/tools/api_tools.py#APIBase.post",
    "shared/tools/api_tools.py#APIBase.proxy_method",
    "shared/tools/api_tools.py#APIBase.put",
}
EXPECTED_PROVENANCE = {
    "auth_core_repo": ("fcc4c7a35fe095fb8d67e72451e3a4f9b497f871", "pylon_auth/plugins/auth_core"),
    "auth_repo": ("ff02d66a8858604e6947bb3a52bda8543dbe0e76", "pylon_main/plugins/auth"),
    "projects_repo": ("efe31605717e84f4857a0af0a2f7732b9377cb67", "pylon_main/plugins/projects"),
    "route_framework_repo": ("6cc508803adffcb0f38573eda7a1ad45e2d4ca39", "pylon"),
    "runtime_config_repo": ("6b3e59f7f41e41c9d5f1dcf7ca6e870d7391986c", "centry"),
    "shared_api_repo": ("81583f7dd2cede7631b002f32d5e86cb2c025516", "pylon_main/plugins/shared"),
}
EXPECTED_SECTION_SHA256 = {
    "authoritative_user_resolution": "5aee72f1a79a663527aae1f2227f14ec5c87b4100ee9142836f563e69b63fecc",
    "auth_core_persistence": "4053216d2ca04b3999f34d4fa41aafe9f461f3c9d1b617c960dfabc1be7d504d",
    "behavior_contracts": "cc8f28b05366e47d6b6a1cd49b160cb7a0492bc65a1810d62f28b174194ac775",
    "behavior_fingerprints": "448548eee245da2680f056ba8136df2053f70869b25014cf4fc30c76700e920e",
    "canonicalization_matrix": "6133ec72d0a8614638c006c14b1ac51a71d0c8512964c3692464efc75d29dfb9",
    "composition_evidence": "90c411068bf0f6e086cf717775374bf4a4db752cf30dc33ef6aab65eb42ebd0c",
    "framework_http_semantics": "eb753526209bcc06d80dace9c69eea83b0d3ab19cb624c85c65b2e63c0214586",
    "global_auth_rpc_gate": "183fcf4a823dca7ebebe4ad7431b928b2fe90ea9225cf29e9b06d817f30f9bac",
    "inference_limits": "c518ca5ac0488ef167f38852e6219a4ff245ce9a4e680abd4526c4c5c0c96e15",
    "method_route_matrix": "720f08a227dafcd55baadb3f0b834dab703aa3d58e74958ff0a89405a8269357",
    "principal_resolution": "8042974cc4196c017d835b6d71a16d74332b6a7a4555278ed5a2ac9bf54096b5",
    "provenance": "f69a13ccb0c7387e1dc5836c84ba5d64124a15b777216bed183fdc00e9ddd864",
    "resources": "218f737477e46c7e85c0540b49443d0795d586a90db0058d7118546e6fc457ef",
    "rpc_exception_translation": "c981d1d037da396103ac8bf66247d3368ab4c70adf483d4227b599bf90d914e8",
    "scope": "6ca21539b50e1fc291b56c1fadac7500ca856061dd7b54b59a82843c634b709c",
    "source_reconstruction": "188c632fc942b93d1262d3148525ca77a2c341187cd2725228d8bfffb50ab238",
    "source_files_sha256": "ffc6021890edb5b320e5dda586588e3c12abedd8c3b255a0de9a87b31ea0b10d",
    "token_encoding": "1a0bff009543deadedd84a8b34c8e985ef3d3dc16ed93d50434e30e80a9716d9",
}
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _contract(catalog: dict[str, Any], contract_id: str) -> dict[str, Any]:
    return next(
        (item for item in catalog.get("behavior_contracts", []) if item.get("id") == contract_id),
        {},
    )


def _statuses(contract: dict[str, Any]) -> list[Any]:
    outcomes = contract.get("outcomes", [])
    return [item.get("status") for item in outcomes if isinstance(item, dict)]


def check_catalog(catalog: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    if catalog.get("schema_version") != 3:
        failures.append("schema_version must be 3")

    forbidden_term = "leg" + "acy"
    if forbidden_term in json.dumps(catalog, sort_keys=True).lower():
        failures.append("fixture uses obsolete baseline terminology")

    scope = catalog.get("scope", {})
    if scope.get("claim") != "bounded current-baseline pylon_main Auth HTTP evidence":
        failures.append("scope claim changed")
    if scope.get("full_auth_parity_claim") is not False:
        failures.append("fixture must not claim full Auth parity")
    if scope.get("covered_contract_ids") != EXPECTED_CONTRACT_IDS:
        failures.append("covered contract IDs or order changed")

    contracts = catalog.get("behavior_contracts", [])
    contract_ids = [item.get("id") for item in contracts if isinstance(item, dict)]
    if sorted(contract_ids) != EXPECTED_CONTRACT_IDS or len(set(contract_ids)) != len(contract_ids):
        failures.append("behavior contract IDs changed or are not unique")

    matrix = catalog.get("method_route_matrix")
    if matrix != EXPECTED_METHOD_ROUTE_MATRIX:
        failures.append("method-route matrix changed")
    elif any(
        contract_id not in EXPECTED_CONTRACT_IDS
        for methods in matrix.values()
        for contract_id in methods.values()
    ):
        failures.append("method-route matrix references an unknown contract")
    if any(route.endswith("//") for route in (matrix or {})):
        failures.append("canonicalized route appears in direct handler matrix")

    canonicalization = catalog.get("canonicalization_matrix")
    if canonicalization != _expected_canonicalization_matrix():
        failures.append("double-slash canonicalization matrix changed")

    resources = catalog.get("resources", {})
    if set(resources) != set(EXPECTED_RESOURCE_METHODS):
        failures.append("resource set changed")
    for name, expected in EXPECTED_RESOURCE_METHODS.items():
        resource = resources.get(name, {})
        for field, value in expected.items():
            if resource.get(field) != value:
                failures.append(f"{name}.{field} changed")

    hashes = catalog.get("source_files_sha256", {})
    if hashes != EXPECTED_SOURCE_HASHES:
        failures.append("reviewed source hashes changed")
    if any(not isinstance(value, str) or not SHA256.fullmatch(value) for value in hashes.values()):
        failures.append("source evidence contains an invalid SHA-256")

    fingerprints = catalog.get("behavior_fingerprints", {})
    if set(fingerprints) != EXPECTED_FINGERPRINT_KEYS:
        failures.append("behavior fingerprint key set changed")
    for name, fingerprint in fingerprints.items():
        if not isinstance(fingerprint, dict):
            failures.append(f"invalid behavior fingerprint {name}")
            continue
        if not SHA256.fullmatch(str(fingerprint.get("ast_sha256", ""))):
            failures.append(f"invalid AST SHA-256 for {name}")
        if not isinstance(fingerprint.get("line"), int) or fingerprint["line"] <= 0:
            failures.append(f"invalid source line for {name}")

    provenance = catalog.get("provenance", {})
    if set(provenance) != set(EXPECTED_PROVENANCE):
        failures.append("provenance repository set changed")
    for name, (head, source_root) in EXPECTED_PROVENANCE.items():
        record = provenance.get(name, {})
        if record.get("pinned_head") != head or record.get("source_root") != source_root:
            failures.append(f"{name} pinned provenance changed")
        if record.get("contract_sources_reconstructable_from_pinned_head") is not True:
            failures.append(f"{name} contract sources are not reconstructable from pinned HEAD")
        if record.get("contract_source_dirty_paths") != []:
            failures.append(f"{name} contract evidence source is dirty")
        if "observed_repository_dirty_paths" in record:
            failures.append(f"{name} includes non-deterministic unrelated dirty paths")

    reconstruction = catalog.get("source_reconstruction", {})
    if "reconstructable" not in str(reconstruction.get("contract_file_hashes", "")):
        failures.append("contract-source reconstruction statement changed")
    if "whole-file dirty state are intentionally non-gating" not in str(
        reconstruction.get("runtime_allow_cors_selector", "")
    ):
        failures.append("ALLOW_CORS provenance statement changed")

    composition = catalog.get("composition_evidence", {})
    if composition.get("auth_init_after") != ["shared", "auth_core"]:
        failures.append("Auth load-order composition changed")
    if composition.get("contract_value_matches_pinned_head") is not True:
        failures.append("Auth load-order selector differs from pinned HEAD")
    if "observed_worktree_path_dirty" in composition:
        failures.append("Auth composition includes non-deterministic dirty-state evidence")

    for section, expected_digest in EXPECTED_SECTION_SHA256.items():
        if _digest(catalog.get(section)) != expected_digest:
            failures.append(f"{section} reviewed snapshot changed")

    gate = catalog.get("global_auth_rpc_gate", {})
    if gate.get("authentication_mode") != "rpc from pylon_main/configs/auth.yml":
        failures.append("global Auth mode changed")
    if gate.get("authorization_request", {}).get("timeout_seconds") != 15:
        failures.append("Auth RPC timeout changed")
    if gate.get("reviewed_routes_match_public_rule") is not False:
        failures.append("reviewed routes must not be marked public")
    expected_denied = {
        "make_response": {"body": "auth_status.data", "session": "destroyed", "status": "auth_status.status_code"},
        "other": {"body": "Access Denied", "session": "kept", "status": 403},
        "public_rule": {"effect": "convert to public principal and continue", "session": "kept"},
        "redirect": {"location": "auth_status.target", "session": "destroyed", "status": 302},
    }
    if gate.get("denied") != expected_denied:
        failures.append("Auth denial branches changed")
    dependency = gate.get("dependency_exception", {})
    if dependency.get("principal") != {"id": "-", "reference": "-", "type": "public"}:
        failures.append("Auth dependency fallback principal changed")
    if "request processing continues" not in str(dependency.get("effect", "")):
        failures.append("Auth dependency-exception continuation is missing")

    collection_get = _contract(catalog, "pat.collection.get")
    if _statuses(collection_get) != [200, 200, 500] or "every token" not in str(collection_get):
        failures.append("PAT collection GET public-fallback behavior changed")
    if "auth.list_tokens" not in str(collection_get) or "auth.encode_token" not in str(
        collection_get
    ):
        failures.append("PAT collection GET dependency-failure behavior changed")
    item_get = _contract(catalog, "pat.item.get")
    if item_get.get("auth", {}).get("owner_check") is not False or _statuses(item_get) != [400, 200, 500]:
        failures.append("PAT item GET behavior changed")

    for post_id, expected_routes in (
        ("pat.collection.post", TOKEN_COLLECTION_ROUTES),
        ("pat.item.post", TOKEN_ITEM_ROUTES),
    ):
        post = _contract(catalog, post_id)
        if post.get("routes") != expected_routes or _statuses(post) != [
            415, 400, 500, 400, 400, 400, 400, 400, 500, 500, 500, 200, 200,
        ]:
            failures.append(f"{post_id} routes or outcomes changed")
        name_semantics = post.get("request", {}).get("name_presence_semantics", {})
        if "400 Name is required" not in str(name_semantics.get("missing", "")):
            failures.append(f"{post_id} missing-name behavior changed")
        if "200 with name=null" not in str(name_semantics.get("null", "")):
            failures.append(f"{post_id} null-name behavior changed")
        if "no type validation" not in str(name_semantics.get("type_mismatch", "")):
            failures.append(f"{post_id} name type-mismatch behavior changed")
        if "ownerless token" not in str(post.get("auth", {}).get("dependency_exception_consequence", "")):
            failures.append(f"{post_id} public ownerless-token consequence changed")
        if "AUTOCOMMIT can leave the new token durable" not in str(post):
            failures.append(f"{post_id} partial-durable-insert consequence changed")
        expires = str(post.get("request", {}).get("json", {}).get("expires", ""))
        if "falsy value bypasses parsing" not in expires or "passed unchanged" not in expires:
            failures.append(f"{post_id} falsy expires behavior changed")
    if "ignored" not in str(
        _contract(catalog, "pat.item.post").get("request", {}).get("path_parameters", {}).get("uid", "")
    ):
        failures.append("PAT item POST ignored-uid behavior changed")

    collection_delete = _contract(catalog, "pat.collection.delete")
    if _statuses(collection_delete) != [500] or "TypeError" not in str(collection_delete):
        failures.append("PAT collection DELETE status/error changed")
    item_delete = _contract(catalog, "pat.item.delete")
    if item_delete.get("auth", {}).get("owner_check") != "token.user_id must equal current_user.id":
        failures.append("PAT item DELETE owner check changed")
    if _statuses(item_delete) != [400, 403, 204, 500]:
        failures.append("PAT item DELETE outcomes changed")
    if item_delete.get("side_effects") != [
        "auth.get_token(uuid=uid)",
        "auth.delete_token(token.id) only after owner check; tracked effective AUTOCOMMIT can make the DELETE durable before the response is observed",
    ]:
        failures.append("PAT item DELETE side effects changed")
    if "AUTOCOMMIT can leave the deletion durable" not in str(item_delete):
        failures.append("PAT item DELETE partial-durable consequence changed")

    current_user = _contract(catalog, "current_user.get")
    if current_user.get("auth", {}).get("handler_falsy_user_check") is not False:
        failures.append("current-user local falsy guard changed")
    if _statuses(current_user) != [200, 200, 500] or "referenced-context RPC" not in str(current_user):
        failures.append("current-user public/error behavior changed")
    permissions = _contract(catalog, "rbac.permissions.get")
    if _statuses(permissions) != [200] or "order is unspecified" not in str(permissions):
        failures.append("permission response behavior changed")
    if "response is []" not in str(permissions.get("auth", {})):
        failures.append("permission public-fallback behavior changed")
    project_id = str(
        permissions.get("request", {}).get("path_parameters", {}).get("project_id", "")
    )
    if "accepts 0" not in project_id or "treats 0 as absent" not in project_id:
        failures.append("RBAC project_id=0 fallback changed")
    if "project_id=0 invokes project_get_id() with a 15-second RPC timeout" not in str(
        permissions.get("side_effects", [])
    ):
        failures.append("RBAC project_id=0 fallback changed")

    inherited = _contract(catalog, "inherited.empty_mode_handlers.404")
    if _statuses(inherited) != [404] or "mode_handlers is empty" not in str(inherited):
        failures.append("inherited APIBase 404 behavior changed")
    head = _contract(catalog, "framework.head_via_get")
    if _statuses(head) != ["same as associated GET contract"] or "GET handler is executed" not in str(head):
        failures.append("HEAD-via-GET behavior changed")
    options = _contract(catalog, "framework.options.cors")
    expected_cors = {
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Origin": "*",
    }
    option_outcomes = options.get("outcomes", [])
    if (
        _statuses(options) != [200]
        or not option_outcomes
        or option_outcomes[0].get("body") != "empty"
        or option_outcomes[0].get("headers") != expected_cors
        or "denial" not in str(options.get("auth", {}).get("denial_masking", ""))
    ):
        failures.append("automatic OPTIONS/CORS behavior changed")
    redirects = _contract(catalog, "framework.merge_slashes.redirect")
    if (
        _statuses(redirects) != [308]
        or redirects.get("routes") != [
            "/api/v2/auth/token//",
            "/api/v2/auth/user//",
        ]
        or "no PAT or current-user resource handler executes" not in str(
            redirects.get("side_effects", [])
        )
    ):
        failures.append("double-slash redirect behavior changed")

    framework = catalog.get("framework_http_semantics", {})
    if framework.get("dependencies_from_pylon_requirements") != {
        "Flask": "3.1.3", "Flask-RESTful": "0.3.10", "Werkzeug": "3.1.6",
    }:
        failures.append("reviewed HTTP framework versions changed")
    cors = framework.get("runtime_cors", {})
    if not all(
        cors.get(key) is True
        for key in (
            "contract_value_matches_pinned_head",
            "observed_worktree_allow_cors",
            "pinned_head_allow_cors",
        )
    ):
        failures.append("reviewed ALLOW_CORS evidence changed")
    if "observed_worktree_path_dirty" in cors:
        failures.append("ALLOW_CORS includes non-deterministic dirty-state evidence")

    persistence = catalog.get("auth_core_persistence", {})
    if persistence.get("base_plugin_db_options_isolation_level") != "AUTOCOMMIT":
        failures.append("Auth Core base AUTOCOMMIT evidence changed")
    if persistence.get("tracked_runtime_override_isolation_level") is not None:
        failures.append("Auth Core tracked runtime isolation override changed")
    if persistence.get("effective_tracked_isolation_level") != "AUTOCOMMIT" or (
        persistence.get("effective_tracked_value_matches_pinned_heads") is not True
    ):
        failures.append("Auth Core effective AUTOCOMMIT evidence changed")
    if persistence.get("tracked_runtime_override_db_option_keys") != [
        "max_overflow",
        "pool_pre_ping",
        "pool_recycle",
        "pool_size",
    ]:
        failures.append("Auth Core runtime pool-option evidence changed")
    if "runtime config-provider payload can override" not in str(
        persistence.get("verification_limit", "")
    ):
        failures.append("Auth Core persistence verification limit changed")

    exception_translation = catalog.get("rpc_exception_translation", {})
    if exception_translation.get("behavior") != {
        "existing_runtime_error": "re-raised unchanged",
        "other_base_exception": "wrapped as RuntimeError containing traceback.format_exc()",
    }:
        failures.append("Auth Core RPC exception translation changed")
    consequences = exception_translation.get("http_consequences", {})
    if "documented 400" not in str(consequences.get("token_lookup", "")) or (
        "generic 500" not in str(consequences.get("uncaught_mutation_or_followup", ""))
    ):
        failures.append("Auth Core RPC HTTP exception consequences changed")

    encoding = catalog.get("token_encoding", {})
    if (
        encoding.get("algorithm") != "HS512"
        or encoding.get("dependency_from_auth_core_requirements") != "PyJWT==2.7.0"
        or encoding.get("byte_level_output_pinned") is not False
    ):
        failures.append("PAT encoding evidence changed")
    if "not token bytes" not in str(encoding.get("limit", "")):
        failures.append("PAT byte-level encoding limit changed")

    authoritative = catalog.get("authoritative_user_resolution", {})
    if "converts every mapping key to str" not in str(authoritative.get("mapping", "")):
        failures.append("authoritative user mapping evidence changed")
    if "RuntimeError" not in str(authoritative.get("missing_user", "")):
        failures.append("authoritative user missing-row behavior changed")

    limits = catalog.get("inference_limits")
    if not isinstance(limits, list) or len(limits) != 5:
        failures.append("bounded inference limits changed")
    elif not any("Social current-author endpoint" in item for item in limits):
        failures.append("Social endpoint exclusion is missing")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path("testdata/baseline/main-auth-http-contracts.json"),
    )
    args = parser.parse_args()
    try:
        catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2
    if not isinstance(catalog, dict):
        print(json.dumps({"error": "catalog must be a JSON object"}, sort_keys=True), file=sys.stderr)
        return 2

    failures = check_catalog(catalog)
    if failures:
        print(
            json.dumps(
                {"error": "invalid pylon_main Auth HTTP evidence", "failures": failures},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    print(
        json.dumps(
            {
                "contracts": len(EXPECTED_CONTRACT_IDS),
                "ok": True,
                "scope": "bounded current-baseline pylon_main Auth HTTP evidence",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
