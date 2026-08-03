/**
 * Pure (non-JSX) helpers for `PlusChatButton.tsx` — split out purely to
 * keep that file under the §3.5 file-length-400 budget, same rationale as
 * `AgentEditorPanel.derive.ts`/`NewChatInput.types.ts` elsewhere in this
 * codebase.
 */

export interface PlusChatButtonEntitySubmenus {
  readonly pipelines?: readonly unknown[];
  readonly toolkits?: readonly unknown[];
  readonly mcps?: readonly unknown[];
  readonly onSelectParticipant?: (participant: unknown) => void;
}

export type SubmenuKey = 'agents' | 'pipelines' | 'toolkits' | 'mcps' | 'attachments' | 'tools';

export interface MenuItemDef {
  key: string;
  label: string;
  icon: string;
  submenu?: SubmenuKey;
}

export const MENU_ITEMS: MenuItemDef[] = [
  { key: 'agents', label: 'Agents', icon: '🤖', submenu: 'agents' },
  { key: 'pipelines', label: 'Pipelines', icon: '📊', submenu: 'pipelines' },
  { key: 'toolkits', label: 'Toolkits', icon: '🧰', submenu: 'toolkits' },
  { key: 'mcps', label: 'MCPs', icon: '🔌', submenu: 'mcps' },
  { key: 'attachments', label: 'Attachments', icon: '📎', submenu: 'attachments' },
  { key: 'tools', label: 'Tools', icon: '⚙️', submenu: 'tools' },
];

interface SubmenuItem {
  key: string;
  label: string;
  onClick?: () => void;
  checked?: boolean;
}

/** `agents`/`pipelines`/`toolkits`/`mcps` share the same "id/name -> selectable row" shape. */
function toEntityItems(list: readonly unknown[], kind: string, onSelect: (participant: unknown) => void): SubmenuItem[] {
  return list.map((entity, i) => {
    const item = entity as { id?: string | number; name?: string };
    const fallbackLabel = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${i + 1}`;
    return {
      key: `${kind}-${item.id ?? i}`,
      label: item.name ?? fallbackLabel,
      onClick: () => onSelect(entity),
    };
  });
}

/** Only called with a truthy `activeSubmenu` (the caller narrows `SubmenuKey | null` first), so it takes the non-null member directly — `switch-exhaustiveness-check` requires every `SubmenuKey` literal handled explicitly (a `default` alone isn't accepted by this project's config). Not exported — only `resolveActiveSubmenuView` below calls it; that's the one this file's own consumers (`PlusChatButton.tsx`) actually need. */
function buildSubmenuItems(input: {
  readonly activeSubmenu: SubmenuKey;
  readonly participants: readonly unknown[];
  readonly entities: PlusChatButtonEntitySubmenus;
  readonly availableTools: readonly { readonly name: string; readonly title: string }[];
  readonly enabledToolNames: readonly string[];
  readonly onInternalToolsConfigChange?: ((config: { key: string; value: boolean }) => void) | undefined;
  readonly onSelect: (participant: unknown) => void;
}): SubmenuItem[] {
  const { activeSubmenu, participants, entities, availableTools, enabledToolNames, onInternalToolsConfigChange, onSelect } = input;
  switch (activeSubmenu) {
    case 'agents':
      return toEntityItems(participants, 'agent', onSelect);
    case 'pipelines':
      return toEntityItems(entities.pipelines ?? [], 'pipeline', onSelect);
    case 'toolkits':
      return toEntityItems(entities.toolkits ?? [], 'toolkit', onSelect);
    case 'mcps':
      return toEntityItems(entities.mcps ?? [], 'mcp', onSelect);
    case 'tools':
      return availableTools.map((tool) => {
        const isEnabled = enabledToolNames.includes(tool.name);
        return {
          key: tool.name,
          label: tool.title,
          checked: isEnabled,
          onClick: () => onInternalToolsConfigChange?.({ key: tool.name, value: !isEnabled }),
        };
      });
    case 'attachments':
      return [];
  }
}

interface SubmenuCreateConfig {
  readonly showCreateNew: boolean;
  readonly onCreateNew: (() => void) | undefined;
}

const CREATABLE_SUBMENUS = new Set<SubmenuKey>(['agents', 'pipelines', 'toolkits', 'mcps']);

/** One lookup instead of an OR-chain plus a 4-way ternary inlined in JSX. */
function resolveSubmenuCreateConfig(
  activeSubmenu: SubmenuKey,
  onCreate: Readonly<Record<'agents' | 'pipelines' | 'toolkits' | 'mcps', () => void>>,
): SubmenuCreateConfig {
  const onCreateNew = activeSubmenu === 'attachments' || activeSubmenu === 'tools' ? undefined : onCreate[activeSubmenu];
  return { showCreateNew: CREATABLE_SUBMENUS.has(activeSubmenu), onCreateNew };
}

interface ActiveSubmenuView {
  readonly items: SubmenuItem[];
  readonly createConfig: SubmenuCreateConfig | undefined;
}

/**
 * Combines `buildSubmenuItems`/`resolveSubmenuCreateConfig` behind the one
 * "is a submenu even open" null-check — split out purely to keep the
 * component itself under the §3.5 cyclomatic-complexity-12 budget (moves
 * both `activeSubmenu ? … : …` ternaries, plus every `??` default for the
 * caller-supplied lists, out of the component's own function scope).
 */
export function resolveActiveSubmenuView(
  activeSubmenu: SubmenuKey | null,
  params: {
    readonly participants: readonly unknown[] | undefined;
    readonly entities: PlusChatButtonEntitySubmenus | undefined;
    readonly availableTools: readonly { readonly name: string; readonly title: string }[];
    readonly enabledToolNames: readonly string[] | undefined;
    readonly onInternalToolsConfigChange?: ((config: { key: string; value: boolean }) => void) | undefined;
    readonly onSelect: (participant: unknown) => void;
    readonly onCreate: Readonly<Record<'agents' | 'pipelines' | 'toolkits' | 'mcps', () => void>>;
  },
): ActiveSubmenuView {
  if (!activeSubmenu) return { items: [], createConfig: undefined };
  const items = buildSubmenuItems({
    activeSubmenu,
    participants: params.participants ?? [],
    entities: params.entities ?? {},
    availableTools: params.availableTools,
    enabledToolNames: params.enabledToolNames ?? [],
    onInternalToolsConfigChange: params.onInternalToolsConfigChange,
    onSelect: params.onSelect,
  });
  return { items, createConfig: resolveSubmenuCreateConfig(activeSubmenu, params.onCreate) };
}
