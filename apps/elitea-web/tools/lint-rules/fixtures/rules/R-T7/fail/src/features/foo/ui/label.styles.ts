interface ThemeLike {
  palette: { primary: { main: string } };
}

export function labelColor(theme: ThemeLike): string {
  return theme.palette.primary.main;
}
