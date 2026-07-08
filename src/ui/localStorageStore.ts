/**
 * localStorageStore — the only browser/DOM-backed KeyValueStore adapter.
 *
 * Wraps `window.localStorage` behind the storage-agnostic `KeyValueStore`
 * interface consumed by `src/core/records.ts`. Private browsing / storage
 * quota / disabled-storage failures are caught so callers never crash —
 * they silently fall back to an in-memory Map for the session.
 */

import type { KeyValueStore } from '../core/records'

/** In-memory fallback used when localStorage is unavailable or throws. */
function createMemoryStore(): KeyValueStore {
  const memory = new Map<string, string>()
  return {
    get(key: string): string | null {
      return memory.get(key) ?? null
    },
    set(key: string, value: string): void {
      memory.set(key, value)
    },
  }
}

/**
 * Create a KeyValueStore backed by `window.localStorage`, probing it once up
 * front so private-mode / storage-disabled browsers get the in-memory
 * fallback immediately rather than failing on first use.
 */
export function createLocalStorageStore(): KeyValueStore {
  const PROBE_KEY = '__gurpil_probe__'

  try {
    if (typeof window !== 'object' || window === null || !window.localStorage) {
      return createMemoryStore()
    }
    window.localStorage.setItem(PROBE_KEY, '1')
    window.localStorage.removeItem(PROBE_KEY)
  } catch {
    return createMemoryStore()
  }

  return {
    get(key: string): string | null {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key: string, value: string): void {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Quota exceeded or storage revoked mid-session — drop silently.
      }
    },
  }
}
