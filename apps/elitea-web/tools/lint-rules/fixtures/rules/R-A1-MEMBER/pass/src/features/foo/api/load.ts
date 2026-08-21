interface Loader {
  readonly fetch: (path: string) => Promise<Response>;
}

export async function load(loader: Loader, path: string): Promise<Response> {
  const response = await loader.fetch(path);
  return response;
}
