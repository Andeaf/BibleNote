import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

export interface RealtimeHub {
  setAuth(accessToken: string | null): void
  /** Keeps exactly one private channel per accessible space. */
  sync(spaceIds: string[]): void
  /** Tells the other devices of these spaces to pull now. */
  broadcast(spaceIds: string[]): void
  stop(): void
}

/**
 * One private channel per space, topic `space:<id>` (policies in migration 0004).
 * Realtime is only a trigger: a "changed" broadcast makes the other devices pull.
 * Presence ("X editează acum") is added on the same channels in phase 4.
 */
export function createRealtimeHub(
  client: SupabaseClient<Database>,
  userId: string,
  onChanged: (spaceId: string) => void,
): RealtimeHub {
  const channels = new Map<string, RealtimeChannel>()

  return {
    setAuth(accessToken) {
      void client.realtime.setAuth(accessToken ?? undefined)
    },

    sync(spaceIds) {
      const wanted = new Set(spaceIds)
      for (const [id, channel] of channels) {
        if (!wanted.has(id)) {
          void client.removeChannel(channel)
          channels.delete(id)
        }
      }
      for (const id of wanted) {
        if (channels.has(id)) continue
        const channel = client
          .channel(`space:${id}`, { config: { private: true, broadcast: { self: false } } })
          .on('broadcast', { event: 'changed' }, () => onChanged(id))
        channel.subscribe()
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

    stop() {
      for (const channel of channels.values()) void client.removeChannel(channel)
      channels.clear()
    },
  }
}
