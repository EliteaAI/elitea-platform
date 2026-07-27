/**
 * User domain type — mirrors OpenAPI schema `UserRecord` / `UserListResponse`
 * / `Role` (services/elitea-main/api/openapi/v2.yaml:808-849, unit W2),
 * sourced from internal/api/v2/eliteacore/handler.go:256-258 (users) and
 * :283-295 (roles, with global admin/editor/viewer defaults when a project
 * has none).
 *
 * NOTE(W2): the router registers GET/POST/PUT/DELETE
 * `/admin/users/{mode}/{projectID}` all onto the same handler, which ignores
 * the method and body — create/update/delete are list-echo no-ops on the Go
 * router today (bug-for-bug parity, spec §7.1). `User` is therefore
 * effectively read-only from this app's perspective.
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
