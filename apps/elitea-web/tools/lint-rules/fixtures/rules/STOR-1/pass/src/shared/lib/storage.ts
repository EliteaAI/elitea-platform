export function readNamespaced(key: string): string | null {
  return localStorage.getItem(`el.${key}`);
}
