/**
 * Rendering + write-path guard for the SCIM group-binding editor.
 *
 * What is asserted here is what a status-code test cannot see:
 *
 *  1. **A new binding POSTs and an edited one PUTs its id.** The two verbs mean
 *     "author a binding" and "re-author that binding"; sending the wrong one
 *     either creates a duplicate group name (refused) or edits nothing.
 *  2. **The screen distinguishes a membership the group GRANTED from one it
 *     merely found.** They behave differently on removal, and an operator who
 *     could not tell them apart would expect a group removal to take somebody
 *     out of a project it will not touch.
 *  3. **A refusal renders the SERVER's own sentence**, which names the project
 *     or the role that was wrong — and the dialog STAYS OPEN holding it.
 *  4. **The delete confirmation says what it withdraws**, because a group
 *     binding removal takes access away from everybody the group granted.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import {
  configureGeneratedClient,
  resetGeneratedClient,
} from "@/shared/api/generated/mutator";
import { server } from "@/test/setup";

import { AdminScimGroupBindingsEditor } from "./AdminScimGroupBindingsEditor";
import { renderAdminRoute } from "./__tests__/testRouter";

const BINDINGS = [
  {
    id: "7",
    display_name: "Platform Team",
    external_id: "grp-1",
    project_id: 12,
    project_name: "Platform",
    role_name: "editor",
    members: [
      { user_id: 1, user_name: "e2e-admin@autotest.local", granted: true },
      { user_id: 2, user_name: "e2e-member@autotest.local", granted: false },
    ],
  },
];

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

let recorded: RecordedRequest[] = [];

function useBindingHandlers(
  options: { saveStatus?: number; saveBody?: Record<string, string> } = {},
): void {
  server.use(
    http.get("*/admin/scim_group_bindings/administration", ({ request }) => {
      recorded.push({ method: "GET", url: request.url, body: null });
      return HttpResponse.json({ bindings: BINDINGS, total: BINDINGS.length });
    }),
    http.post(
      "*/admin/scim_group_bindings/administration",
      async ({ request }) => {
        recorded.push({
          method: "POST",
          url: request.url,
          body: await request.json(),
        });
        if (options.saveStatus !== undefined) {
          return HttpResponse.json(options.saveBody, {
            status: options.saveStatus,
          });
        }
        return HttpResponse.json({ binding: BINDINGS[0] }, { status: 201 });
      },
    ),
    http.put(
      "*/admin/scim_group_bindings/administration/*",
      async ({ request }) => {
        recorded.push({
          method: "PUT",
          url: request.url,
          body: await request.json(),
        });
        if (options.saveStatus !== undefined) {
          return HttpResponse.json(options.saveBody, {
            status: options.saveStatus,
          });
        }
        return HttpResponse.json({ binding: BINDINGS[0] });
      },
    ),
    http.delete(
      "*/admin/scim_group_bindings/administration/*",
      ({ request }) => {
        recorded.push({ method: "DELETE", url: request.url, body: null });
        return new HttpResponse(null, { status: 204 });
      },
    ),
    // The project picker's sources. They are separate permissions from the
    // binding surface, which is why the dialog has a fallback for their absence.
    http.get("*/admin/projects/administration", () =>
      HttpResponse.json({ rows: [{ id: 12, name: "Platform" }], total: 1 }),
    ),
    http.get("*/admin/roles/administration/*", () =>
      HttpResponse.json({
        rows: [
          { id: "1", name: "admin" },
          { id: "2", name: "editor" },
          { id: "3", name: "viewer" },
        ],
        total: 3,
      }),
    ),
  );
}

function writes(): RecordedRequest[] {
  return recorded.filter((entry) => entry.method !== "GET");
}

beforeEach(() => {
  recorded = [];
  configureGeneratedClient({ baseUrl: "/api/v2" });
  useBindingHandlers();
});

afterEach(() => {
  resetGeneratedClient();
});

describe("Admin › Authentication › SCIM group bindings", () => {
  it("lists a binding with the project and the role it grants", async () => {
    renderAdminRoute(<AdminScimGroupBindingsEditor />);

    expect(await screen.findByText("Platform Team")).toBeInTheDocument();
    expect(screen.getByText("Platform (#12)")).toBeInTheDocument();
    expect(screen.getByText("editor")).toBeInTheDocument();
  });

  it("says who the group granted and who it merely found", async () => {
    renderAdminRoute(<AdminScimGroupBindingsEditor />);
    await screen.findByText("Platform Team");

    expect(screen.getByText("1 granted")).toBeInTheDocument();
    // The member the group did not create keeps their access when the group
    // lets go. The screen must not present them as the same thing.
    expect(screen.getByText("1 already members")).toBeInTheDocument();
  });

  it("reads the bindings from the administration mode", async () => {
    renderAdminRoute(<AdminScimGroupBindingsEditor />);
    await screen.findByText("Platform Team");

    expect(recorded[0]?.url).toContain(
      "/admin/scim_group_bindings/administration",
    );
  });

  it("POSTs a new binding and PUTs an edited one", async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminScimGroupBindingsEditor />);
    await screen.findByText("Platform Team");

    await user.click(screen.getByTestId("admin-scim-group-bindings-add"));
    await user.type(screen.getByTestId("admin-scim-binding-name"), "Finance");
    await user.click(screen.getByLabelText("Project"));
    await user.click(
      await screen.findByText("Platform (#12)", { selector: "li" }),
    );
    await user.click(screen.getByLabelText("Role"));
    await user.click(await screen.findByRole("option", { name: "viewer" }));
    await user.click(screen.getByTestId("admin-scim-binding-save"));

    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    const created = writes()[0];
    expect(created?.method).toBe("POST");
    expect(created?.body).toEqual({
      display_name: "Finance",
      project_id: 12,
      role_name: "viewer",
    });

    // And the same screen, editing the existing row, addresses it by id.
    const row = screen.getByText("Platform Team").closest("tr");
    const edit = Array.from(row?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Edit",
    );
    await user.click(edit as HTMLElement);
    await user.click(screen.getByTestId("admin-scim-binding-save"));

    await waitFor(() => {
      expect(writes()).toHaveLength(2);
    });
    expect(writes()[1]?.method).toBe("PUT");
    expect(writes()[1]?.url).toContain(
      "/admin/scim_group_bindings/administration/7",
    );
  });

  it("keeps the dialog open on a refusal and renders the server sentence", async () => {
    useBindingHandlers({
      saveStatus: 400,
      saveBody: { error: 'project 12 has no role "auditor"' },
    });
    const user = userEvent.setup();
    renderAdminRoute(<AdminScimGroupBindingsEditor />);
    await screen.findByText("Platform Team");

    const row = screen.getByText("Platform Team").closest("tr");
    const edit = Array.from(row?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Edit",
    );
    await user.click(edit as HTMLElement);
    await user.click(screen.getByTestId("admin-scim-binding-save"));

    expect(
      await screen.findByTestId("admin-scim-binding-dialog-error"),
    ).toHaveTextContent("auditor");
    // Still open, still holding what was typed.
    expect(screen.getByTestId("admin-scim-binding-save")).toBeInTheDocument();
  });

  it("confirms a removal by saying what it withdraws, then deletes by id", async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminScimGroupBindingsEditor />);
    await screen.findByText("Platform Team");

    const row = screen.getByText("Platform Team").closest("tr");
    const remove = Array.from(row?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Remove",
    );
    await user.click(remove as HTMLElement);

    const dialog = await screen.findByTestId(
      "admin-scim-binding-delete-dialog",
    );
    expect(dialog).toHaveTextContent("withdraws");
    expect(dialog).toHaveTextContent("added by hand are not affected");

    await user.click(screen.getByTestId("admin-scim-binding-delete-confirm"));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(writes()[0]?.method).toBe("DELETE");
    expect(writes()[0]?.url).toContain(
      "/admin/scim_group_bindings/administration/7",
    );
  });

  it('does not report "no group is bound" while the listing is failing', async () => {
    server.use(
      http.get("*/admin/scim_group_bindings/administration", () =>
        HttpResponse.json({ error: "nope" }, { status: 503 }),
      ),
    );
    renderAdminRoute(<AdminScimGroupBindingsEditor />);

    expect(
      await screen.findByTestId("admin-scim-group-bindings-error"),
    ).toBeInTheDocument();
    // "No group is bound" is a sentence an operator acts on. It must never be
    // the rendering of a failed read.
    expect(
      screen.queryByTestId("admin-scim-group-bindings-empty"),
    ).not.toBeInTheDocument();
  });
});
