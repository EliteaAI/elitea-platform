/**
 * What the caller may do on the project secrets surface.
 *
 * Each field names the permission the SERVER checks for that operation
 * (services/elitea-main/internal/api/v2/secrets/handler.go). A control whose
 * permission is false is not rendered, because pressing it can only produce a
 * 403.
 *
 * This group exists because of #402. Before it,
 * `configuration.secrets.secret.list` and the five write strings had the same
 * holders — admin and editor — so no role could reach a populated table without
 * also holding every write. #402 gives the LIST to the viewer, and the viewer is
 * the first role that can read this page and change nothing on it. The write
 * controls were never gated (the old app did not gate them either), so for that
 * role they would render, fire, and fail. Two of them — delete and hide — fail
 * with no toast at all.
 *
 * It lives in its own leaf module rather than beside the table that consumes it.
 * `SecretsTable` renders `SecretRow` and `SecretActionsMenu`, and both of those
 * need the type, so declaring it in `SecretsTable` made each of them import
 * their own parent and the layer gate reported two import cycles.
 */
export interface SecretPermissions {
  /** `configuration.secrets.secret.unsecret` — reveal or copy a plaintext value. */
  readonly canUnsecret: boolean;
  /** `configuration.secrets.secret.create` */
  readonly canCreate: boolean;
  /** `configuration.secrets.secret.edit` */
  readonly canEdit: boolean;
  /** `configuration.secrets.secret.delete` */
  readonly canDelete: boolean;
  /** `configuration.secrets.secret.hide` */
  readonly canHide: boolean;
}
