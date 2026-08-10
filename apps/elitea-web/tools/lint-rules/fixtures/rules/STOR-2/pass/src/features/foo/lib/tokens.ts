// Storage reached through the injected namespaced wrapper — no raw global.
interface NamespacedStorage {
  set(key: string, value: string): void;
}

export function saveToken(store: NamespacedStorage, value: string): void {
  store.set('mcp.tokens', value);
}
