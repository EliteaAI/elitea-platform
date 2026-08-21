export async function load(path: string): Promise<Response> {
  const response = await window.fetch(path);
  return response;
}
