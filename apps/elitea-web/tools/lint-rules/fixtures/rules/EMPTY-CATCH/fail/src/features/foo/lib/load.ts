export function load(read: () => string): string {
  let result = '';
  try {
    result = read();
  } catch {}
  return result;
}
