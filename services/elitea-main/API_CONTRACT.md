# API Contract: SPA ↔ Go Backend

This document defines the exact response shapes expected by the EliteaUI SPA for each endpoint served by `elitea-main`. The SPA (RTK Query) is the source of truth — the Go backend must match these shapes exactly.

## Response Shape Legend

| Shape | JSON | Used by |
|-------|------|---------|
| **Paginated rows** | `{"rows": [...], "total": N}` | Most paginated lists (apps, skills, toolkits, tags, icons, public apps) |
| **Paginated items** | `{"items": [...], "total": N, "offset": N, "limit": N}` | Configurations only |
| **Plain array** | `[...]` | Authors, trending authors, default icons, permissions |
| **Single object** | `{...}` | Detail endpoints, settings, mutations |
| **Wrapped result** | `{"result": {...}}` | Fork toolkit |

---

## Endpoint Contract Table

### Applications (`/elitea_core/applications/...`)

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /applications/prompt_lib/{pid}` | `v2apps.List` | `{"rows": [...], "total": N}` | ✅ OK |
| `GET /application/prompt_lib/{pid}/{aid}` | `v2apps.Get` | Single object `{id, name, version_details, ...}` | ✅ OK |
| `GET /versions/prompt_lib/{pid}/{aid}` | `v2apps.ListVersions` | `{"items": versions}` | ⚠️ NEEDS CHECK — SPA usage unclear |
| `GET /version/prompt_lib/{pid}/{aid}/{vid}` | `v2apps.GetVersion` | Single version object | ✅ OK |

### Public Applications

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /public_applications/prompt_lib` | `coreHandler.PublicApplications` | `{"rows": [...], "total": N}` | ✅ OK |
| `GET /public_application/prompt_lib/{aid}[/{vname}]` | `coreHandler.publicApplicationDetail` | Single object `{id, name, version_details, ...}` | ✅ OK |

### Admin Published Agents

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /admin_published_agents/administration` | `coreHandler.AdminPublishedAgents` | `{"items": [...], "total": N}` | ⚠️ UNKNOWN — admin UI may expect `items` or `rows` |

### Icons

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /upload_icon/prompt_lib/{pid}` | `coreHandler.ListUploadedIcons` | `{"rows": [...], "total": N}` | ✅ FIXED |
| `GET /default_icons/prompt_lib/{pid}` | `coreHandler.DefaultIcons` | **Plain array** `[...]` | ✅ FIXED |
| `GET /upload_skill_icon/prompt_lib/{pid}` | (not yet implemented) | `{"rows": [...], "total": N}` | ❌ MISSING |

### Skills (`/elitea_core/skills/...`)

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /skills/prompt_lib/{pid}` | `v2skills.List` | `{"rows": [...], "total": N}` | ✅ OK (needs verify) |
| `GET /skill/prompt_lib/{pid}/{sid}[/{vid}]` | `v2skills.Get` | Single skill object | ✅ OK |

### Toolkits (`/elitea_core/tools/...`)

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /tools/prompt_lib/{pid}` | `v2toolkits.List` | `{"rows": [...], "total": N}` | ✅ OK |
| `GET /tool/prompt_lib/{pid}/{tid}` | `v2toolkits.Get` | Single toolkit object | ✅ OK |
| `GET /toolkits/prompt_lib/{pid}` | `v2toolkits.ListTypeSchemas` | Type schemas array | ✅ OK |
| `GET /toolkit_types/prompt_lib/{pid}` | `v2toolkits.ListTypes` | `{"rows": [...], "total": N}` | ✅ FIXED |
| `GET /toolkit_available_tools/prompt_lib/{pid}/{tid}` | `v2toolkits.AvailableTools` | `{"tools": [...], "total": N}` | ⚠️ NEEDS CHECK |
| `POST /fork_toolkit/prompt_lib/{pid}` | `v2toolkits.ForkToolkit` | `{"result": {...}}` | ⚠️ NEEDS CHECK |
| `GET /index_meta/prompt_lib/{pid}/{tid}` | `v2toolkits.IndexMeta` | **Plain array** `[...]` | ✅ FIXED |

### Tags (`/elitea_core/tags/...`)

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /tags/prompt_lib/{pid}` | `v2tags.List` | `{"rows": [...], "total": N}` | ✅ OK |

### Configurations (`/configurations/...`)

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /configurations/{pid}` | `v2configs.List` | `{"items": [...], "total": N, "offset": N, "limit": N, "shared": {...}}` | ✅ OK |
| `GET /configuration/{pid}/{cid}` | `v2configs.Get` | Single config object | ✅ OK |
| `GET /models/{pid}` | `v2configs.ListModels` | `{"items": [...], "total": N}` | ✅ OK |

### Social (`/social/...`)

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /social/authors/{pid}` | `v2social.ListAuthors` | **Plain array** `[...]` | ✅ FIXED |
| `GET /social/author/` | `v2social.GetAuthor` | Single object `{id, name, email, ...}` | ✅ OK |
| `PUT /social/author/` | `v2social.UpdateAuthor` | `{"ok": true}` | ✅ OK |

### Trending Authors (`/elitea_core/trending_authors/...`)

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /trending_authors/prompt_lib/{pid}` | `coreHandler.TrendingAuthors` | **Plain array** `[...]` | ✅ FIXED |

### Author Detail (`/elitea_core/author/...`)

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /author/prompt_lib/{aid}` | `coreHandler.Author` | Single object `{id, name, email, ...}` | ✅ OK |

### Agent Categories

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /agent_categories/prompt_lib/{pid}` | `coreHandler.AgentCategories` | `{"categories": [...], "total": N}` | ✅ OK (SPA uses `data?.categories`) |

### Recommendations

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /recommendations/prompt_lib/{pid}` | `coreHandler.Recommendations` | `{"applications": [...], "total": N}` | ✅ FIXED |

### Notifications

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /notifications/notifications/prompt_lib/{pid}` | `coreHandler.Notifications` | `{"rows": [...], "total": N}` | ✅ OK |

### Users/Roles

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /users/{mode}/{pid}` | `coreHandler.Users` | `{"rows": [...], "total": N}` | ✅ OK |
| `GET /roles/{mode}/{pid}` | `coreHandler.Roles` | **Plain array** `[...]` | ✅ OK |

### Permissions

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /permissions/prompt_lib/{pid}` | `coreHandler.Permissions` | **Plain array** `[{name, enabled}, ...]` | ✅ OK |

### Platform Settings

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /platform_settings/prompt_lib[/{pid}]` | `coreHandler.PlatformSettings` | Single settings object | ✅ OK |

### Project Context

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /project_context/prompt_lib/{pid}/project-context` | `coreHandler.ProjectContext` | `{"content": "...", "enabled": bool}` | ✅ OK |
| `GET /project_info/prompt_lib/{pid}/project-info` | `coreHandler.ProjectInfo` | `{"name": "...", "icon_meta": ...}` | ✅ OK |

### Search Options

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /search_options/prompt_lib/{pid}` | `coreHandler.SearchOptions` | `{"tags": [...], "collections": [...]}` | ✅ OK |

### Chat Config

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /chat_config/prompt_lib/{pid}` | `coreHandler.ChatConfig` | `{"models": [...], "default_model": "..."}` | ✅ OK |

### Collections

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /collections/prompt_lib/{pid}` | `coreHandler.ListCollections` | `{"rows": [...], "total": N}` | ✅ OK |
| `GET /collection/prompt_lib/{pid}/{cid}` | `coreHandler.GetCollection` | Single object `{id, name, applications: {rows, total}, pipelines: {rows, total}}` | ✅ OK |

### Pin/Unpin

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `POST /pin/prompt_lib/{pid}/{type}/{eid}` | `coreHandler.Pin` | `{"ok": true}` | ✅ OK |
| `DELETE /pin/prompt_lib/{pid}/{type}/{eid}` | `coreHandler.Unpin` | `{"ok": true}` | ✅ OK |

### Conversations

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /conversations/prompt_lib/{pid}` | `v2convs.List` | `{"rows": [...], "total": N}` or plain array | ⚠️ NEEDS CHECK |
| `GET /messages/prompt_lib/{pid}/{cid}` | `v2convs.ListMessages` | Plain array `[...]` OR `{"rows": [...], "total": N}` (SPA handles both) | ⚠️ NEEDS CHECK |

### Support Assistant

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /support_assistant/config/` | `coreHandler.SupportConfig` | Single config object | ✅ OK |

### Context Manager

| Endpoint | Go Handler | Expected Response | Status |
|----------|-----------|-------------------|--------|
| `GET /context_manager/summaries/{pid}/{cid}` | `v2contextmgr.ListSummaries` | `{"summaries": [...]}` | ⚠️ NEEDS CHECK — unique key name |

---

## Confirmed Mismatches (ALL FIXED)

All confirmed mismatches have been resolved.

## Previously Fixed (this session)

| # | Endpoint | Was | Now | Handler Location |
|---|----------|-----|-----|-----------------|
| 1 | `GET /upload_icon/prompt_lib/{pid}` | `{"items":[],"total":0}` | `{"rows":[],"total":0}` | `eliteacore/handler.go:1786` |
| 2 | `GET /default_icons/prompt_lib/{pid}` | `{"items":[...],"total":N}` | `[...]` plain array | `eliteacore/handler.go:1733` |
| 3 | `GET /social/authors/{pid}` | `{"items":[...],"total":N}` | `[...]` plain array | `social/handler.go:166` |
| 4 | `GET /social/trending_authors/prompt_lib/{pid}` | `{"items":[...],"total":N}` | `[...]` plain array | `social/handler.go:197` |
| 5 | `GET /trending_authors/prompt_lib/{pid}` | `{"items":[],"total":0}` | `[...]` plain array | `eliteacore/handler.go:1543` |
| 6 | `GET /recommendations/prompt_lib/{pid}` | `{"items":[...],"total":N}` | `{"applications":[...],"total":N}` | `eliteacore/handler.go:1686` |
| 7 | `GET /toolkit_types/prompt_lib/{pid}` | `{"toolkit_types":[...],"total":N}` | `{"rows":[...],"total":N}` | `toolkits/handler.go:98` |
| 8 | `GET /index_meta/prompt_lib/{pid}/{tid}` | `{"items":[...],"total":N}` | `[...]` plain array | `toolkits/handler.go:422` |

---

## Key Rules for Future Endpoints

1. **Paginated lists with infinite scroll** → `{"rows": [...], "total": N}`
2. **Configurations only** → `{"items": [...], "total": N, "offset": N, "limit": N}`
3. **Non-paginated collections** (authors, trending, default icons, permissions, roles) → **Plain array** `[...]`
4. **Detail/single resource** → Single object `{...}`
5. **Mutations** → `{"ok": true}` or the created/updated object
6. **Context manager summaries** → `{"summaries": [...]}`
7. **Never mix `items` and `rows`** — check the SPA endpoint definition before implementing
