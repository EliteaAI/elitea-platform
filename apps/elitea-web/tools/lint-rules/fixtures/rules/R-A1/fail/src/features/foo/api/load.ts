export async function load(): Promise<Response> {
  const response = await fetch('/api/v2/things');
  return response;
}
