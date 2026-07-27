interface ThemeLike {
  vars: { palette: { primary: { main: string } } };
}

export function labelColor(theme: ThemeLike): string {
  return theme.vars.palette.primary.main;
}
