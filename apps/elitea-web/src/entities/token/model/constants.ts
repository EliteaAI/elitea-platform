/** Token expiration options for the CreatePersonalToken form. */
export const TOKEN_EXPIRATION_OPTIONS = [
  { label: 'Never', value: 'never' as const },
  { label: 'Days', value: 'days' as const },
  { label: 'Weeks', value: 'weeks' as const },
  { label: 'Hours', value: 'hours' as const },
  { label: 'Minutes', value: 'minutes' as const },
] as const;

/** Default expiration value when "Days" is selected. */
export const DEFAULT_TOKEN_EXPIRATION_VALUE = 30;

/** Maximum character length for a personal token name. */
export const MAX_TOKEN_NAME_LENGTH = 64;

/** Allowed character pattern for token names. */
export const TOKEN_NAME_PATTERN = /^[a-zA-Z0-9_-]*$/;

/** IDE settings preview types and labels. */
export const SETTINGS_PREVIEW_TYPES = {
  VSCODE: 'vscode',
  JETBRAINS: 'jetbrains',
} as const;

export const SETTINGS_PREVIEW_LABELS: Record<string, string> = {
  [SETTINGS_PREVIEW_TYPES.VSCODE]: 'VSCode',
  [SETTINGS_PREVIEW_TYPES.JETBRAINS]: 'JetBrains',
};
