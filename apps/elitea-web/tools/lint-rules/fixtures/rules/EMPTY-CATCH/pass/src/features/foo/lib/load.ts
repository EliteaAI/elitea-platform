export function load(read: () => string, onError: (e: unknown) => void): string {
  let result = '';
  try {
    result = read();
  } catch (error) {
    onError(error);
  }
  return result;
}
