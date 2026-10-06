import { createContext, useContext, useSyncExternalStore } from 'react'
import type { BibleNoteDb } from '@/lib/db'
import type { SyncRuntime } from './runtime'
import type { SyncState } from './types'

export const SyncContext = createContext<SyncRuntime | null>(null)

export function useSyncRuntime(): SyncRuntime {
  const runtime = useContext(SyncContext)
  if (!runtime) throw new Error('useSyncRuntime must be used inside <SyncProvider>')
  return runtime
}

/** The local database of the signed-in account; every screen reads through this. */
export function useDb(): BibleNoteDb {
  return useSyncRuntime().db
}

export function useSyncState(): SyncState {
  const { engine } = useSyncRuntime()
  return useSyncExternalStore(engine.state.subscribe, engine.state.get, engine.state.get)
}
