/**
 * Tiny typed wrapper around `localStorage` with versioned schemas.
 *
 * - Server-safe: returns defaults when `window` is undefined.
 * - Resilient: invalid JSON, quota errors, or schema mismatches fall back to defaults.
 * - Versioned: bump `version` when the shape changes; pass `migrate` to upgrade old data.
 *
 * Usage:
 *   const store = createPersistedStore<MyShape>({
 *     key: "namespace.feature",
 *     version: 1,
 *     defaults: { ... },
 *   });
 *   const data = store.read();
 *   store.update((d) => ({ ...d, count: d.count + 1 }));
 */

interface StorageSchema<T> {
  /** Unique localStorage key — namespace it (e.g., "neuroflora.x") to avoid collisions. */
  key: string;
  /** Bump when the shape of T changes incompatibly. */
  version: number;
  /** Deep-cloneable default value. */
  defaults: T;
  /** Optional migration from older versions. Returns the new shape or null to fall back to defaults. */
  migrate?: (data: unknown, fromVersion: number) => T | null;
}

export interface PersistedStore<T> {
  read(): T;
  write(data: T): void;
  update(updater: (current: T) => T): T;
  reset(): void;
}

interface Envelope<T> {
  version: number;
  data: T;
}

const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const cloneDefaults = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

export function createPersistedStore<T>(schema: StorageSchema<T>): PersistedStore<T> {
  const fallback = (): T => cloneDefaults(schema.defaults);

  function read(): T {
    if (!isBrowser()) return fallback();
    try {
      const raw = window.localStorage.getItem(schema.key);
      if (!raw) return fallback();
      const parsed = JSON.parse(raw) as Envelope<unknown> | null;
      if (!parsed || typeof parsed !== "object") return fallback();

      if (parsed.version === schema.version) {
        return parsed.data as T;
      }
      if (schema.migrate) {
        const migrated = schema.migrate(parsed.data, parsed.version ?? 0);
        if (migrated) {
          write(migrated);
          return migrated;
        }
      }
      return fallback();
    } catch {
      return fallback();
    }
  }

  function write(data: T): void {
    if (!isBrowser()) return;
    try {
      const envelope: Envelope<T> = { version: schema.version, data };
      window.localStorage.setItem(schema.key, JSON.stringify(envelope));
    } catch {
      // Quota exceeded, private mode, or storage disabled — fail silently.
    }
  }

  function update(updater: (current: T) => T): T {
    const next = updater(read());
    write(next);
    return next;
  }

  function reset(): void {
    write(fallback());
  }

  return { read, write, update, reset };
}
