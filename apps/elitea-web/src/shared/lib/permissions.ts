/**
 * Permission-string constants ported from
 * apps/elitea-ui/src/common/constants.js:521-616 (unit S3, spec §9.3).
 *
 * These are the RBAC permission-string identifiers the backend checks
 * (`configuration.*`, `models.*`) — opaque strings, not brand/design tokens
 * or route definitions. P8 in the spec notes the old app's route guards
 * never actually supplied these; unit R1/R2 are what wires real permission
 * checks — this file is just the typed string catalogue.
 */

export const PERMISSIONS = {
  chat: {
    list: 'models.chat.conversations.list',
    create: 'models.chat.conversations.create',
    canvas: {
      create: 'models.chat.canvas.create',
      update: 'models.chat.canvas.update',
    },
    folders: {
      get: 'models.chat.folders.get',
      create: 'models.chat.folders.create',
      update: 'models.chat.folders.update',
      delete: 'models.chat.folders.delete',
    },
  },
  applications: {
    list: 'models.applications.public_applications.list',
    create: 'models.applications.applications.create',
    publish: 'models.applications.publish.post',
    export: 'models.applications.export_import.export',
    fork: 'models.applications.fork.post',
    delete: 'models.applications.application.delete',
    update: 'models.applications.application.update',
  },
  pipelines: {
    list: 'models.applications.public_applications.list',
    create: 'models.applications.applications.create',
    publish: 'models.applications.publish.post',
    export: 'models.applications.export_import.export',
    fork: 'models.applications.fork.post',
    delete: 'models.applications.application.delete',
  },
  /**
   * `skills.publish` is the string
   * `internal/api/router.go` mounts the four project-scoped skill-publishing
   * routes behind. The other skill verbs the legacy catalogue carries
   * (`list`/`create`/`update`/`delete`) are not declared here because nothing
   * in this app gates on them yet, and a constant with no reader is what the
   * dead-code gate exists to catch.
   */
  skills: {
    publish: 'models.applications.skills.publish',
  },
  users: {
    view: 'configuration.users.users.view',
    edit: 'configuration.users.users.edit',
    create: 'configuration.users.users.create',
    delete: 'configuration.users.users.delete',
  },
  projectContext: {
    view: 'models.project_context.view',
    edit: 'models.project_context.edit',
  },
  secrets: {
    view: 'configuration.secrets.secret.view',
    list: 'configuration.secrets.secret.list',
    edit: 'configuration.secrets.secret.edit',
    create: 'configuration.secrets.secret.create',
    delete: 'configuration.secrets.secret.delete',
    hide: 'configuration.secrets.secret.hide',
    unsecret: 'configuration.secrets.secret.unsecret',
  },
  artifacts: {
    create: 'configuration.artifacts.artifacts.create',
    delete: 'configuration.artifacts.artifacts.delete',
    view: 'configuration.artifacts.artifacts.view',
    buckets: {
      delete: 'configuration.artifacts.buckets.delete',
      update: 'configuration.artifacts.buckets.update',
      create: 'configuration.artifacts.buckets.create',
      view: 'configuration.artifacts.buckets.view',
    },
  },
  toolkits: {
    list: 'models.applications.tools.list',
    details: 'models.applications.tool.details',
    create: 'models.applications.tools.create',
    update: 'models.applications.tool.update',
    delete: 'models.applications.tool.delete',
    patch: 'models.applications.tool.patch',
    fork: 'models.applications.fork.post',
    export: 'models.applications.tools.export',
  },
  configuration: {
    delete: 'configurations.configuration.delete',
    update: 'configurations.configuration.update',
  },
  litellm: {
    section: 'configuration.litellm',
    edit: 'configuration.litellm.edit',
  },
  index: {
    schedule: 'models.applications.index_meta.edit',
  },
} as const;

/** `constants.js:609-616` — the permission a nav entity needs at minimum to render. */
export const PERMISSION_GROUPS = {
  chat: [PERMISSIONS.chat.folders.get],
  agents: [PERMISSIONS.applications.list],
  pipelines: [PERMISSIONS.pipelines.list],
  credentials: [PERMISSIONS.toolkits.list],
  artifacts: [PERMISSIONS.artifacts.view],
  toolkits: [PERMISSIONS.toolkits.list],
} as const;
