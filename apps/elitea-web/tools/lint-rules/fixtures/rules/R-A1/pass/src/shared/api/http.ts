export async function eliteaFetch(input: string): Promise<Response> {
  const response = await fetch(input);
  return response;
}
