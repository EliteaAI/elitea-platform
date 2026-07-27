export function readPref(key: string): string | null {
  return localStorage.getItem(key);
}
