export const badgeSx = {
  color: 'var(--el-palette-primary-main)',
  borderColor: 'var(--el-palette-divider)',
};

// GREEN half of issue #189: `#130` and `#413` are valid three-digit hex
// strings, but here they are issue references. The rule must not report them.
export const badgeNote = 'Tint moved to a token in (#130). See issue #189.';
export const badgeCase = '#413 — the badge keeps its token after a failed read';
