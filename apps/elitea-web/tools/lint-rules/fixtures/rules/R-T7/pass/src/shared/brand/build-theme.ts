interface ThemeLike {
  palette: { primary: { main: string } };
}

export function brandPrimary(theme: ThemeLike): string {
  return theme.palette.primary.main;
}
