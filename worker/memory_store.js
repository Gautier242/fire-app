// worker/memory_store.js
// The in-memory half of the storage seam. This is the reference implementation
// of the interface: get / put / list / delete, keys namespaced by prefix.
//
// ttlSeconds is a storage hint only. Expiry that a reader can observe is decided
// by the record's own expiresAt against the injected clock, never by the store,
// because no store expires a key at the instant it falls due.

export function memoryStore(seed = []) {
  const map = new Map(seed);
  return {
    async get(key) {
      const value = map.get(key);
      return value === undefined ? null : structuredClone(value);
    },
    async put(key, value /* , { ttlSeconds } */) {
      map.set(key, structuredClone(value));
    },
    async list(prefix, cap) {
      const out = [];
      for (const [key, value] of map) {
        if (!key.startsWith(prefix)) continue;
        if (out.length >= cap) break;
        out.push(structuredClone(value));
      }
      return out;
    },
    async delete(key) {
      map.delete(key);
    },
    // Tests only: proof that a rejected write persisted nothing at all.
    _size: () => map.size,
  };
}
