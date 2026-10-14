import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, JoinResult, ShareLinkRow, SpaceMemberRow } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'
import { toApiError } from './supabaseApi'

/**
 * Sharing: online-only actions, never queued. Entering through a link, and
 * for the owner of a space its two links and the people with access. Share links are not
 * synced: only the owner can read them (RLS), and they matter only with a connection.
 */
export interface ShareApi {
  /** Enters a space through a link; the role never goes down. Errors: BN_INVALID_LINK. */
  joinByToken(token: string, displayName: string | null): Promise<JoinResult>
  links(spaceId: string): Promise<ShareLinkRow[]>
  /** Turns a link on or off; `removeMembers` also removes the people who entered with it. */
  setLinkEnabled(linkId: string, enabled: boolean, removeMembers: boolean): Promise<ShareLinkRow>
  /** A new token: the old link stops working. */
  regenerateLink(linkId: string, removeMembers: boolean): Promise<ShareLinkRow>
  /** People with access (the owner is not one of them: spaces.owner_id). */
  members(spaceId: string): Promise<SpaceMemberRow[]>
  /** "Scoate": owner only (RLS); 0 rows deleted is an error. */
  removeMember(memberId: string): Promise<void>
}

export function createShareApi(client: SupabaseClient<Database>): ShareApi {
  return {
    async joinByToken(token, displayName) {
      const { data, error, status } = await client.rpc('join_by_token', {
        p_token: token,
        p_display_name: displayName,
      })
      if (error) throw toApiError(error, status)
      return data as unknown as JoinResult
    },

    async links(spaceId) {
      const { data, error, status } = await client
        .from('share_links')
        .select('*')
        .eq('space_id', spaceId)
      if (error) throw toApiError(error, status)
      return data ?? []
    },

    async setLinkEnabled(linkId, enabled, removeMembers) {
      const { data, error, status } = await client.rpc('set_link_enabled', {
        p_link_id: linkId,
        p_enabled: enabled,
        p_remove_members: removeMembers,
      })
      if (error) throw toApiError(error, status)
      return data as unknown as ShareLinkRow
    },

    async regenerateLink(linkId, removeMembers) {
      const { data, error, status } = await client.rpc('regenerate_share_link', {
        p_link_id: linkId,
        p_remove_members: removeMembers,
      })
      if (error) throw toApiError(error, status)
      return data as unknown as ShareLinkRow
    },

    async members(spaceId) {
      const { data, error, status } = await client
        .from('space_members')
        .select('*')
        .eq('space_id', spaceId)
      if (error) throw toApiError(error, status)
      return data ?? []
    },

    async removeMember(memberId) {
      const { data, error, status } = await client
        .from('space_members')
        .delete()
        .eq('id', memberId)
        .select('id')
      if (error) throw toApiError(error, status)
      // RLS answers a denied delete with 0 rows, never 403.
      if (!data || data.length === 0) throw toApiError({ message: 'BN_NO_ROWS' }, 403)
    },
  }
}

/** The app's share API (the join page runs before any sync runtime exists). */
export const shareApi = createShareApi(supabase)
