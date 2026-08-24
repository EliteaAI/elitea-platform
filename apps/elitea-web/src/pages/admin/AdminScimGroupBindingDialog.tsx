/**
 * Admin › Configuration › Authentication — the group-binding dialog.
 *
 * It collects the three values a SCIM group cannot carry: which group, which
 * project, and which role its members receive.
 *
 * ## The project and the role are RESOLVED, not typed
 *
 * The project comes from the admin project listing and the role from that
 * project's own roles, so a binding cannot name a project that does not exist
 * or a role the project does not have. The server refuses both anyway; asking
 * an operator to guess an id and then telling them they guessed wrong is the
 * worse half of that pair.
 *
 * When the project listing cannot be read — it is gated on
 * `projects.projects.projects.view`, which the binding permission does not
 * imply — the dialog falls back to a numeric project id and a typed role name,
 * and SAYS that it did. Rendering an empty picker would read as "this
 * deployment has no projects".
 */
import { useEffect, useMemo, useState } from "react";

import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";

import { t } from "@/shared/i18n";

import { useAdminProjects, type AdminProjectRow } from "./api/adminProjectsApi";
import { useAdminScimGroupProjectRoles } from "./api/adminScimGroupBindingsApi";
import type {
  AdminScimGroupBinding,
  AdminScimGroupBindingDraft,
} from "./api/adminScimGroupBindingsApi";

/**
 * The project picker reads ONE page and filters it in the browser.
 *
 * A server-side search driven by the input would re-query on every keystroke,
 * and the re-render it causes feeds the control's own input event — MUI's
 * Autocomplete then loops. A page of this size covers every deployment this
 * screen has, and an operator on a larger one still has the id field the
 * fallback below renders.
 */
const PROJECT_PAGE_SIZE = 200;

/**
 * The project field.
 *
 * A picker when the project listing can be read, and a numeric id when it
 * cannot — the listing is gated on `projects.projects.projects.view`, which the
 * binding permission does not imply. The fallback SAYS why it is there: an
 * empty picker would read as "this deployment has no projects".
 */
function ProjectField({
  unavailable,
  loading,
  projects,
  selected,
  projectId,
  onSelect,
}: {
  readonly unavailable: boolean;
  readonly loading: boolean;
  readonly projects: readonly AdminProjectRow[];
  readonly selected: AdminProjectRow | undefined;
  readonly projectId: string;
  readonly onSelect: (projectId: string) => void;
}) {
  if (unavailable) {
    return (
      <>
        <Alert
          severity="warning"
          data-testid="admin-scim-binding-projects-error"
        >
          {t(
            "pages.admin.scimGroups.dialog.projectsUnavailable",
            "The project list could not be read, so the project must be entered by its id. It needs the project view permission.",
          )}
        </Alert>
        <TextField
          label={t("pages.admin.scimGroups.dialog.projectId", "Project id")}
          value={projectId}
          onChange={(event) => {
            onSelect(event.target.value.replace(/\D/gu, ""));
          }}
          fullWidth
          slotProps={{
            htmlInput: { "data-testid": "admin-scim-binding-project-id" },
          }}
        />
      </>
    );
  }
  return (
    <Autocomplete
      options={projects}
      value={selected ?? null}
      loading={loading}
      getOptionLabel={(project) => `${project.name} (#${String(project.id)})`}
      isOptionEqualToValue={(option, value) => option.id === value.id}
      onChange={(_event, project) => {
        onSelect(project === null ? "" : String(project.id));
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={t("pages.admin.scimGroups.dialog.project", "Project")}
          helperText={t(
            "pages.admin.scimGroups.dialog.projectHelp",
            "The project this group grants access to. A group push never creates one.",
          )}
          // The whole of the Autocomplete's own slotProps is carried through and
          // only `htmlInput` is extended: replacing the object would drop the
          // input adornments the control renders its buttons into.
          slotProps={{
            ...params.slotProps,
            htmlInput: {
              ...params.slotProps?.htmlInput,
              "data-testid": "admin-scim-binding-project",
            },
          }}
        />
      )}
    />
  );
}

/**
 * The role field. A select over the CHOSEN PROJECT's own roles, so a binding
 * cannot name a role the project does not have; typed when those roles cannot
 * be read.
 */
function RoleField({
  typed,
  loading,
  roles,
  projectChosen,
  value,
  onChange,
}: {
  readonly typed: boolean;
  readonly loading: boolean;
  readonly roles: readonly string[];
  readonly projectChosen: boolean;
  readonly value: string;
  readonly onChange: (role: string) => void;
}) {
  if (!typed && projectChosen && !loading && roles.length === 0) {
    // An EMPTY answer is a true one: this project carries no roles, so no
    // binding on it can grant anything. Offering the platform defaults here is
    // how a control comes to suggest a value its own save refuses.
    return (
      <Alert severity="warning" data-testid="admin-scim-binding-no-roles">
        {t(
          "pages.admin.scimGroups.dialog.noRoles",
          "This project has no roles, so a group cannot grant anything on it. Provision the project, or choose another.",
        )}
      </Alert>
    );
  }
  if (typed) {
    return (
      <TextField
        label={t("pages.admin.scimGroups.dialog.role", "Role")}
        helperText={t(
          "pages.admin.scimGroups.dialog.roleHelpTyped",
          "The project role every member of this group receives. A project is provisioned with admin, editor, viewer and system.",
        )}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        fullWidth
        slotProps={{ htmlInput: { "data-testid": "admin-scim-binding-role" } }}
      />
    );
  }
  return (
    <TextField
      select
      label={t("pages.admin.scimGroups.dialog.role", "Role")}
      helperText={t(
        "pages.admin.scimGroups.dialog.roleHelp",
        "The project role every member of this group receives. Membership on this platform is always a role on a project.",
      )}
      value={value}
      disabled={!projectChosen || loading}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      fullWidth
      slotProps={{ htmlInput: { "data-testid": "admin-scim-binding-role" } }}
    >
      {roles.map((role) => (
        <MenuItem key={role} value={role}>
          {role}
        </MenuItem>
      ))}
    </TextField>
  );
}

export interface AdminScimGroupBindingDialogProps {
  readonly open: boolean;
  readonly editing: AdminScimGroupBinding | undefined;
  readonly isSaving: boolean;
  readonly serverError: string | undefined;
  readonly onClose: () => void;
  readonly onSubmit: (draft: AdminScimGroupBindingDraft) => void;
}

export function AdminScimGroupBindingDialog({
  open,
  editing,
  isSaving,
  serverError,
  onClose,
  onSubmit,
}: AdminScimGroupBindingDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [roleName, setRoleName] = useState("");

  // The form is re-seeded when the dialog OPENS, not on every render: an
  // operator's typing must survive a parent re-render, and a re-open of the
  // same row must not show the previous row's values.
  useEffect(() => {
    if (!open) return;
    setDisplayName(editing?.display_name ?? "");
    setProjectId(editing === undefined ? "" : String(editing.project_id));
    setRoleName(editing?.role_name ?? "");
  }, [open, editing]);

  const projectsQuery = useAdminProjects({
    limit: PROJECT_PAGE_SIZE,
    offset: 0,
  });
  const projects = useMemo(
    () => projectsQuery.data?.rows ?? [],
    [projectsQuery.data],
  );
  const projectsUnavailable = projectsQuery.error != null;

  const numericProjectId = Number(projectId);
  // The project's OWN roles, and only once a project is chosen. NOT the general
  // role listing: it answers a hardcoded admin/editor/viewer for a project that
  // carries no role rows, and a control fed by that offers a role its own save
  // then refuses. See useAdminScimGroupProjectRoles.
  const rolesQuery = useAdminScimGroupProjectRoles(numericProjectId);
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const rolesUnavailable = rolesQuery.error != null;

  const selectedProject = projects.find(
    (project) => String(project.id) === projectId,
  );

  const complete =
    displayName.trim() !== "" &&
    Number.isInteger(numericProjectId) &&
    numericProjectId > 0 &&
    roleName.trim() !== "";

  const submit = (): void => {
    if (!complete) return;
    const draft = {
      displayName: displayName.trim(),
      projectId: numericProjectId,
      roleName: roleName.trim(),
    };
    // `id` is SPREAD IN only when there is one. `exactOptionalPropertyTypes`
    // distinguishes an absent property from one set to `undefined`, and the
    // absent one is what "this is a new binding" means to the client — it
    // chooses POST over PUT.
    onSubmit(editing === undefined ? draft : { ...draft, id: editing.id });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="admin-scim-binding-dialog"
    >
      <DialogTitle>
        {editing === undefined
          ? t(
              "pages.admin.scimGroups.dialog.addTitle",
              "Bind a directory group",
            )
          : t("pages.admin.scimGroups.dialog.editTitle", "Edit group binding")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: "0.5rem" }}>
          {serverError !== undefined ? (
            <Alert
              severity="error"
              data-testid="admin-scim-binding-dialog-error"
            >
              {serverError}
            </Alert>
          ) : null}

          {/* Stated BEFORE the save, because the save applies it. */}
          {editing !== undefined ? (
            <Alert severity="info" data-testid="admin-scim-binding-move-note">
              {t(
                "pages.admin.scimGroups.dialog.moveNote",
                "Changing the project or the role moves the access this group granted: its members lose the old role and receive the new one. Members added by hand are not affected.",
              )}
            </Alert>
          ) : null}

          <TextField
            label={t(
              "pages.admin.scimGroups.dialog.groupName",
              "Group name at the identity provider",
            )}
            helperText={t(
              "pages.admin.scimGroups.dialog.groupNameHelp",
              "The displayName the identity provider pushes. The first push is matched on it; afterwards the group is matched on its own identifier, so a rename keeps working.",
            )}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            fullWidth
            slotProps={{
              htmlInput: { "data-testid": "admin-scim-binding-name" },
            }}
          />

          <ProjectField
            unavailable={projectsUnavailable}
            loading={projectsQuery.isLoading}
            projects={projects}
            selected={selectedProject}
            projectId={projectId}
            onSelect={(id) => {
              setProjectId(id);
              // The role belongs to the project, so it cannot outlive a change
              // of project.
              setRoleName("");
            }}
          />

          <RoleField
            typed={rolesUnavailable || projectsUnavailable}
            loading={rolesQuery.isLoading}
            roles={roles}
            projectChosen={projectId !== ""}
            value={roleName}
            onChange={setRoleName}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={isSaving}
          sx={{ textTransform: "none" }}
        >
          {t("pages.admin.scimGroups.dialog.cancel", "Cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!complete || isSaving}
          sx={{ textTransform: "none" }}
          data-testid="admin-scim-binding-save"
        >
          {t("pages.admin.scimGroups.dialog.save", "Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
