interface ThemeLike {
  palette: { mode: string };
}

export function panelBg(theme: ThemeLike, isDarkMode: boolean): string {
  const byTheme = theme.palette.mode === 'dark' ? 'var(--el-a)' : 'var(--el-b)';
  const byFlag = isDarkMode ? 'var(--el-a)' : 'var(--el-b)';
  return byTheme + byFlag;
}
