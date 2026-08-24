/**
 * Admin › Configuration › Authentication — the SCIM group bindings.
 *
 * It renders under the identity providers, because it is the other half of the
 * same story: a provider federates the LOGIN, and SCIM pushes the DIRECTORY.
 *
 * ## What a binding is for
 *
 * A SCIM group carries a name and a list of members. Membership here is always
 * (user, project, role), so a group says nothing about half of what it would
 * have to grant. A binding is that half, authored here: one group, one project,
 * one role. A group the identity provider pushes with no binding is refused and
 * named — it never creates a project, and it never guesses a role.
 *
 * ## What the table says, and why the `granted` column exists
 *
 * A member the group GRANTED loses the role when they leave the group. A member
 * who already held it keeps it: the identity provider is authoritative over
 * what it gave, not over what it found. Without that distinction on screen, an
 * operator would remove somebody from a group and expect them out of the
 * project.
 */
import { useMemo, useState } from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { t } from "@/shared/i18n";

import { AdminScimGroupBindingDialog } from "./AdminScimGroupBindingDialog";
import { configFailureReason } from "./api/adminConfigurationApi";
import {
  useAdminScimGroupBindings,
  useDeleteAdminScimGroupBinding,
  useSaveAdminScimGroupBinding,
  type AdminScimGroupBinding,
  type AdminScimGroupBindingDraft,
} from "./api/adminScimGroupBindingsApi";

/** The members cell. It names who the group granted and who it merely found. */
function MemberSummary({
  binding,
}: {
  readonly binding: AdminScimGroupBinding;
}) {
  const granted = binding.members.filter((member) => member.granted).length;
  const found = binding.members.length - granted;
  if (binding.members.length === 0) {
    return (
      <Typography variant="bodySmall" color="text.secondary">
        {t("pages.admin.scimGroups.table.noMembers", "No push has arrived yet")}
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1}>
      <Chip
        size="small"
        label={t("pages.admin.scimGroups.table.granted", "{{count}} granted", {
          count: granted,
        })}
      />
      {found > 0 ? (
        <Chip
          size="small"
          variant="outlined"
          label={t(
            "pages.admin.scimGroups.table.alreadyMembers",
            "{{count}} already members",
            {
              count: found,
            },
          )}
        />
      ) : null}
    </Stack>
  );
}

export function AdminScimGroupBindingsEditor() {
  const listQuery = useAdminScimGroupBindings();
  const saveMutation = useSaveAdminScimGroupBinding();
  const deleteMutation = useDeleteAdminScimGroupBinding();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminScimGroupBinding | undefined>(
    undefined,
  );
  const [pendingDelete, setPendingDelete] = useState<
    AdminScimGroupBinding | undefined
  >(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  // A new array each render would defeat every memo downstream.
  const bindings = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const handleSubmit = (draft: AdminScimGroupBindingDraft): void => {
    setSaveError(undefined);
    saveMutation.mutate(draft, {
      onSuccess: () => {
        setDialogOpen(false);
        setEditing(undefined);
      },
      // The dialog STAYS OPEN on a refusal, holding what was typed together
      // with the server's own sentence — which names the project or the role
      // that was wrong.
      onError: (error: unknown) => {
        setSaveError(
          configFailureReason(error) ??
            t(
              "pages.admin.scimGroups.error.save",
              "Failed to save that group binding.",
            ),
        );
      },
    });
  };

  const handleDelete = (): void => {
    if (pendingDelete === undefined) return;
    setActionError(undefined);
    deleteMutation.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(undefined);
      },
      onError: (error: unknown) => {
        setActionError(
          configFailureReason(error) ??
            t(
              "pages.admin.scimGroups.error.delete",
              "Failed to remove that group binding.",
            ),
        );
        setPendingDelete(undefined);
      },
    });
  };

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: "1rem" }}
      data-testid="admin-scim-group-bindings"
    >
      <Typography variant="subtitle1">
        {t(
          "pages.admin.scimGroups.title",
          "Directory group provisioning (SCIM)",
        )}
      </Typography>

      <Typography variant="bodySmall" color="text.secondary">
        {t(
          "pages.admin.scimGroups.description",
          "A directory group grants one role on one project. Bind the group here first: a group an identity provider pushes with no binding is refused, and a push never creates or deletes a project.",
        )}
      </Typography>

      {listQuery.isLoading ? <LinearProgress /> : null}

      {listQuery.error != null ? (
        <Alert severity="warning" data-testid="admin-scim-group-bindings-error">
          {configFailureReason(listQuery.error) ??
            t(
              "pages.admin.scimGroups.error.load",
              "Failed to load the group bindings.",
            )}
        </Alert>
      ) : null}

      {actionError !== undefined ? (
        <Alert
          severity="error"
          onClose={() => {
            setActionError(undefined);
          }}
          data-testid="admin-scim-group-bindings-action-error"
        >
          {actionError}
        </Alert>
      ) : null}

      <Box>
        <Button
          size="small"
          variant="contained"
          onClick={() => {
            setEditing(undefined);
            setSaveError(undefined);
            setDialogOpen(true);
          }}
          sx={{ textTransform: "none" }}
          data-testid="admin-scim-group-bindings-add"
        >
          {t("pages.admin.scimGroups.add", "Bind a group")}
        </Button>
      </Box>

      {!listQuery.isLoading &&
      bindings.length === 0 &&
      listQuery.error == null ? (
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          data-testid="admin-scim-group-bindings-empty"
        >
          {t(
            "pages.admin.scimGroups.empty",
            "No directory group is bound. Group provisioning refuses every push until a group is bound to a project and a role.",
          )}
        </Typography>
      ) : null}

      {bindings.length > 0 ? (
        <Table
          size="small"
          aria-label={t("pages.admin.scimGroups.table.label", "Group bindings")}
        >
          <TableHead>
            <TableRow>
              <TableCell>
                {t("pages.admin.scimGroups.table.group", "Group")}
              </TableCell>
              <TableCell>
                {t("pages.admin.scimGroups.table.project", "Project")}
              </TableCell>
              <TableCell>
                {t("pages.admin.scimGroups.table.role", "Role")}
              </TableCell>
              <TableCell>
                {t("pages.admin.scimGroups.table.members", "Members")}
              </TableCell>
              <TableCell align="right">
                {t("pages.admin.scimGroups.table.actions", "Actions")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bindings.map((binding) => (
              <TableRow
                key={binding.id}
                data-testid={`admin-scim-group-binding-${binding.id}`}
              >
                <TableCell>{binding.display_name}</TableCell>
                <TableCell>
                  {binding.project_name === undefined ||
                  binding.project_name === ""
                    ? `#${String(binding.project_id)}`
                    : `${binding.project_name} (#${String(binding.project_id)})`}
                </TableCell>
                <TableCell>{binding.role_name}</TableCell>
                <TableCell>
                  <MemberSummary binding={binding} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(binding);
                      setSaveError(undefined);
                      setDialogOpen(true);
                    }}
                    sx={{ textTransform: "none" }}
                  >
                    {t("pages.admin.scimGroups.table.edit", "Edit")}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => {
                      setPendingDelete(binding);
                    }}
                    sx={{ textTransform: "none" }}
                  >
                    {t("pages.admin.scimGroups.table.remove", "Remove")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <AdminScimGroupBindingDialog
        open={dialogOpen}
        editing={editing}
        isSaving={saveMutation.isPending}
        serverError={saveError}
        onClose={() => {
          setDialogOpen(false);
          setEditing(undefined);
        }}
        onSubmit={handleSubmit}
      />

      <Dialog
        open={pendingDelete !== undefined}
        onClose={() => {
          setPendingDelete(undefined);
        }}
        maxWidth="xs"
        fullWidth
        data-testid="admin-scim-binding-delete-dialog"
      >
        <DialogTitle>
          {t("pages.admin.scimGroups.delete.title", "Remove group binding")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="bodyMedium">
            {t(
              "pages.admin.scimGroups.delete.body",
              "This withdraws the role “{{name}}” gave its members and removes the binding. The project, its content and any member added by hand are not affected, and the identity provider is refused until the group is bound again.",
              { name: pendingDelete?.display_name ?? "" },
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPendingDelete(undefined);
            }}
            disabled={deleteMutation.isPending}
            sx={{ textTransform: "none" }}
          >
            {t("pages.admin.scimGroups.delete.cancel", "Cancel")}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            sx={{ textTransform: "none" }}
            data-testid="admin-scim-binding-delete-confirm"
          >
            {t("pages.admin.scimGroups.delete.confirm", "Remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
