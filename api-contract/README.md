# ARCHIVED — Elitea API Contract (grpc-gateway approach)

> **This directory is superseded.** The platform now uses:
> - **External REST API**: `services/elitea-main/api/openapi/v2.yaml` (OpenAPI 3.0.3 → oapi-codegen)
> - **Internal gRPC**: `proto/` (buf v2 → `gen/go/`, `gen/python/`)
>
> No new code should reference this directory. It is preserved for historical context only.

---

Protobuf-based API contract for the Elitea platform. This repository holds
`.proto` source files for all service domains, `buf` configuration for linting
and code generation, and a Makefile that wires everything together.

## Directory layout

```
api-contract/
├── buf.yaml            # buf module config (lint + breaking rules, deps)
├── buf.gen.yaml        # code generation config (Go, gRPC, grpc-gateway)
├── Makefile            # install / generate / lint / breaking / clean targets
├── proto/
│   └── elitea/
│       └── v1/         # all proto source files
│           ├── common.proto
│           ├── admin.proto
│           ├── analytics.proto
│           ├── applications.proto
│           ├── artifacts.proto
│           ├── auth.proto
│           ├── chat.proto
│           ├── configurations.proto
│           ├── notifications.proto
│           ├── resources.proto
│           ├── search.proto
│           ├── secrets.proto
│           ├── settings.proto
│           ├── skills.proto
│           ├── social.proto
│           ├── tags.proto
│           └── toolkits.proto
├── gen/
│   └── go/             # generated Go stubs (git-ignored, recreate with make generate)
└── scripts/
    └── extract-api.sh  # helper: extract endpoints from EliteaUI RTK Query files
```

## Prerequisites

- Go 1.21+
- [buf](https://buf.build/docs/installation) v1.x

## Quick start

### 1. Install tools

```bash
make install
```

This installs `buf`, `protoc-gen-go`, `protoc-gen-go-grpc`, and
`protoc-gen-grpc-gateway` into your `$GOPATH/bin`.

### 2. Generate code

```bash
make generate
```

Generated Go stubs land in `gen/go/`.

### 3. Lint

```bash
make lint
```

Runs `buf lint` against the DEFAULT rule set configured in `buf.yaml`.

### 4. Check for breaking changes

```bash
make breaking
```

Compares the current proto files against the `main` branch and reports any
breaking changes (FILE category).

### 5. Clean generated files

```bash
make clean
```

## Code generation plugins

| Plugin | Output | Options |
|--------|--------|---------|
| `buf.build/protocolbuffers/go` | `gen/go/` | `paths=source_relative` |
| `buf.build/grpc/go` | `gen/go/` | `paths=source_relative` |
| `buf.build/grpc-ecosystem/gateway` | `gen/go/` | `paths=source_relative`, `generate_unbound_methods=true` |

## Domain coverage

| Proto file | Service(s) | URL prefix |
|------------|-----------|------------|
| `admin.proto` | `AdminService` | `/api/v2/admin/` |
| `analytics.proto` | `AnalyticsService` | `/api/v2/elitea_core/analytics*/` |
| `applications.proto` | `ApplicationsService`, `ProjectsService` | `/api/v2/elitea_core/applications/` |
| `artifacts.proto` | `ArtifactsService` | `/api/v2/artifacts/`, `/artifacts/s3/` |
| `auth.proto` | `AuthService` | `/api/v2/auth/`, `/api/v2/elitea_core/mcp_*` |
| `chat.proto` | `ChatService` | `/api/v2/elitea_core/` (chat), `/api/v2/context_manager/` |
| `configurations.proto` | `ConfigurationsService` | `/api/v2/configurations/` |
| `notifications.proto` | `NotificationsService` | `/api/v2/notifications/` |
| `resources.proto` | `ResourcesService` | `/api/v2/admin/system_info/`, `/api/v2/admin/plugin_config_values/` |
| `search.proto` | `SearchService` | `/api/v2/elitea_core/search_options/` |
| `secrets.proto` | `SecretsService` | `/api/v2/secrets/` |
| `settings.proto` | `SettingsService` | `/api/v2/elitea_core/project_info/`, `/api/v2/elitea_core/project_icon/` |
| `skills.proto` | `SkillsService` | `/api/v2/elitea_core/skills/`, `/api/v2/elitea_core/skill/` |
| `social.proto` | `SocialService` | `/api/v2/social/`, `/api/v2/elitea_core/trending_authors/` |
| `tags.proto` | `TagsService` | `/api/v2/elitea_core/tags/` |
| `toolkits.proto` | `ToolkitsService` | `/api/v2/elitea_core/tools/`, `/api/v2/elitea_core/tool/` |

## Extracting endpoints from the frontend

The helper script scans the EliteaUI RTK Query API slices and emits a JSON
array of `{endpoint, method, url}` objects:

```bash
./scripts/extract-api.sh /path/to/EliteaUI/src
```

Output is written to stdout and can be piped to `jq` for filtering.

## Style conventions

- Package names follow `elitea.v1.<domain>` (or `elitea.<domain>.v1` for
  auth, which uses the monorepo convention).
- All `go_package` options point to
  `github.com/EliteaAI/elitea-platform/gen/go/elitea/v1/<domain>`.
- Dynamic/untyped API payloads use `google.protobuf.Struct`; strongly-typed
  fields are added incrementally as the Go service is hardened.
- grpc-gateway HTTP bindings preserve the existing camelCase URL contracts
  (e.g. `/api/v2/elitea_core/applications/prompt_lib/{project_id}`).
