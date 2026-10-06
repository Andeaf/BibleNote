/** Minimal external store for React's useSyncExternalStore. */
export interface Store<T> {
  get(): T
  set(next: T): void
  update(patch: Partial<T>): void
  subscribe(listener: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    get: () => value,
    set: (next) => {
      value = next
      emit()
    },
    update: (patch) => {
      value = { ...value, ...patch }
      emit()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
