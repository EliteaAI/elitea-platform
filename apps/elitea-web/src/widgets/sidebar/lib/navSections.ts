/**
 * Pure nav-section data + permission filtering (spec SHELL-001..010). Old
 * app: `[fsd]/widgets/sidebar-root/ui/SidebarBody.jsx`'s `sections` useMemo
 * (lines 93-199) + `lib/constants/sidebar.constants.js`'s
 * `RouteToSideBarItemMap`.
 *
 * `mcps`/`skills` visibility gates (`useIsMcpVisible`, "hide skills on the
 * public project") are old-app hooks this widget cannot reach (they live in
 * `[fsd]/shared/lib/hooks`, not ported into this app's `shared/lib` by any
 * landed Wave-1 unit) — both items are therefore always shown, gated ONLY by
 * `PERMISSION_GROUPS` same as every other entry. Documented, not silently
 * dropped.
 */
import { PERMISSION_GROUPS } from '@/shared/lib/permissions';

export type NavItemValue =
  | 'chat'
  | 'agents'
  | 'pipelines'
  | 'skills'
  | 'toolkits'
  | 'mcps'
  | 'credentials'
  | 'applications'
  | 'artifacts';

export interface NavItem {
  readonly value: NavItemValue;
  readonly label: string;
  readonly url: string;
}

export interface NavSection {
  readonly items: readonly NavItem[];
}

/** SHELL-001..009, in the old app's 3-group layout. Route paths verified against `src/routes/_shell/**`. */
export function navSections(): readonly NavSection[] {
  return [
    {
      items: [
        { value: 'chat', label: 'Chats', url: '/chat' },
        { value: 'agents', label: 'Agents', url: '/agents' },
        { value: 'pipelines', label: 'Pipelines', url: '/pipelines' },
      ],
    },
    {
      items: [
        { value: 'skills', label: 'Skills', url: '/skills' },
        { value: 'toolkits', label: 'Toolkits', url: '/toolkits' },
        { value: 'mcps', label: 'MCPs', url: '/mcps' },
        { value: 'credentials', label: 'Credentials', url: '/credentials' },
        { value: 'applications', label: 'Applications', url: '/apps' },
      ],
    },
    {
      items: [{ value: 'artifacts', label: 'Artifacts', url: '/artifacts' }],
    },
  ];
}

/** `PERMISSION_GROUPS` has no `applications`/`mcps` entry (old app: `mcps` reuses the `toolkits` group's permission list; `applications`/`skills` are ungated). */
function requiredPermissionsFor(value: NavItemValue): readonly string[] | undefined {
  if (value === 'mcps') return PERMISSION_GROUPS.toolkits;
  if (value in PERMISSION_GROUPS) return PERMISSION_GROUPS[value as keyof typeof PERMISSION_GROUPS];
  return undefined;
}

/** SHELL-010: filters sections/items by the caller's permission set; empty sections are dropped entirely (old app: `.filter(section => section.length > 0)`). */
export function visibleNavSections(
  sections: readonly NavSection[],
  permissions: ReadonlySet<string>,
): readonly NavSection[] {
  return sections
    .map((section) => ({
      items: section.items.filter((item) => {
        const required = requiredPermissionsFor(item.value);
        return !required || required.length === 0 || required.some((permission) => permissions.has(permission));
      }),
    }))
    .filter((section) => section.items.length > 0);
}

/** SidebarBody's `selectedItem` useMemo — which nav item (if any) matches the current pathname. `/agents-hub` deliberately matches nothing (old app: explicit early return for `RouteDefinitions.AgentHub`). */
export function selectedNavItem(pathname: string, items: readonly NavItem[]): NavItemValue | undefined {
  if (pathname === '/agents-hub') return undefined;
  return items.find((item) => pathname.startsWith(item.url))?.value;
}
