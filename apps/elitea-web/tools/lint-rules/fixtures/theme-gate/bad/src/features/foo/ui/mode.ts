export const pick = (theme: { palette: { mode: string } }, isDarkMode: boolean) => {
  const a = theme.palette.mode === 'dark' ? 1 : 2;
  const b = isDarkMode ? 3 : 4;
  return a + b;
};
