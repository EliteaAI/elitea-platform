/**
 * User domain type — mirrors OpenAPI schema `UserRecord` / `UserListResponse`
 * / `Role` (services/elitea-main/api/openapi/v2.yaml:808-849, unit W2),
 * sourced from internal/api/v2/eliteacore/handler.go:256-258 (users) and
 * :283-295 (roles, with global admin/editor/viewer defaults when a project
 * has none).
 *
 * NOTE(#130): the router USED TO register GET/POST/PUT/DELETE
 * `/admin/users/{mode}/{projectID}` all onto the same handler, which ignores
 * the method and body — so create/update/delete were list-echo no-ops and
 * `User` was effectively read-only from this app's perspective. That is fixed:
 * the three write verbs have real handlers
 * (services/elitea-main/internal/api/v2/eliteacore/users_write.go) and their
 * effects are visible on the very next read.
 */
export interface User {
  /** Numeric id serialized as string (`fmt.Sprintf("%d")`). */
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly string[];
}

export interface UserPage {
  readonly rows: readonly User[];
  readonly total: number;
}

/**
 * `Role` (v2.yaml:839-849). Global defaults `admin`/`editor`/`viewer` are
 * synthesized by the Go handler when a project has no roles of its own.
 */
export interface Role {
  /** Numeric id serialized as string. */
  readonly id: string;
  readonly name: string;
}
