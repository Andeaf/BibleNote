import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { createStore, type Store } from './store'

/** Someone with a note open (docs/PLAN.md §5.7, "X editează acum"). */
export interface PresenceEntry {
  user_id: string
  name: string
  note_id: string | null
}

export interface RealtimeHub {
  setAuth(accessToken: string | null): void
  /** Keeps exactly one private channel per accessible space. */
  sync(spaceIds: string[]): void
  /** Tells the other devices of these spaces to pull now. */
  broadcast(spaceIds: string[]): void
  /** Who is present in each space, and which note they have open (this user included). */
  presence: Store<Record<string, PresenceEntry[]>>
  /** Publishes the note this user is editing in a space; null when they leave it. */
  setPresence(spaceId: string, entry: { name: string; noteId: string } | null): void
  stop(): void
}

/**
 * One private channel per space, topic `space:<id>` (policies in migration 0004).
 * Realtime is only a trigger: a "changed" broadcast makes the other devices pull. Presence on
 * the same channel says who has which note open; it is published once the channel is joined
 * (and again after every reconnect, which supabase-js handles for tracked state).
 */
export function createRealtimeHub(
  client: SupabaseClient<Database>,
  userId: string,
  onChanged: (spaceId: string) => void,
): RealtimeHub {
  const channels = new Map<string, RealtimeChannel>()
  const joined = new Set<string>()
  const wanted = new Map<string, PresenceEntry>()
  const presence = createStore<Record<string, PresenceEntry[]>>({})

  const publish = (spaceId: string, channel: RealtimeChannel) => {
    const state = channel.presenceState<PresenceEntry>()
    const entries = Object.values(state)
      .flat()
      .map(({ user_id, name, note_id }) => ({ user_id, name, note_id }))
    presence.set({ ...presence.get(), [spaceId]: entries })
  }

  const apply = (spaceId: string) => {
    const channel = channels.get(spaceId)
    if (!channel || !joined.has(spaceId)) return
    const entry = wanted.get(spaceId)
    void (entry ? channel.track(entry) : channel.untrack())
  }

  const forget = (spaceId: string) => {
    joined.delete(spaceId)
    const next = { ...presence.get() }
    delete next[spaceId]
    presence.set(next)
  }

  return {
    presence,

    setAuth(accessToken) {
      void client.realtime.setAuth(accessToken ?? undefined)
    },

    sync(spaceIds) {
      const keep = new Set(spaceIds)
      for (const [id, channel] of channels) {
        if (!keep.has(id)) {
          void client.removeChannel(channel)
          channels.delete(id)
          forget(id)
        }
      }
      for (const id of keep) {
        if (channels.has(id)) continue
        const channel = client
          .channel(`space:${id}`, { config: { private: true, broadcast: { self: false } } })
          .on('broadcast', { event: 'changed' }, () => onChanged(id))
          .on('presence', { event: 'sync' }, () => publish(id, channel))
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            joined.add(id)
            apply(id)
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            joined.delete(id)
          }
        })
        channels.set(id, channel)
      }
    },

    broadcast(spaceIds) {
      for (const id of spaceIds) {
        const channel = channels.get(id)
        if (!channel) continue
        void channel.send({ type: 'broadcast', event: 'changed', payload: { by: userId } })
      }
    },

    setPresence(spaceId, entry) {
      if (entry) wanted.set(spaceId, { user_id: userId, name: entry.name, note_id: entry.noteId })
      else wanted.delete(spaceId)
      apply(spaceId)
    },

    stop() {
      for (const channel of channels.values()) void client.removeChannel(channel)
      channels.clear()
      joined.clear()
      wanted.clear()
      presence.set({})
    },
  }
}
