/**
 * Security test against a real Supabase project: RLS, RPCs, Storage and Realtime policies.
 * Run with `npm run test:rls`; needs .env.test.local (see README.md).
 *
 * It creates throwaway users (owner, editor, viewer, stranger, newcomer, anonymous guest), two
 * spaces, exercises every cell of the access matrix and deletes everything it created. Since
 * 2026-10-15 every account may create its own spaces; only anonymous link guests may not.
 * Tests run in file order; destructive ones (disable/regenerate links) come last. Phase 4 adds
 * the sharing flows: guests through links, roles that never go down, removing people, presence.
 * Phase 6 adds the trash: trashed_at set by the server only, purge_expired, purged paths, listing.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../src/lib/database.types.ts'

type Client = SupabaseClient<Database>
interface TestUser {
  id: string
  email: string
  client: Client
}
interface Link {
  id: string
  token: string
}

function requireEnv() {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      'Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.test.local',
    )
  }
  return { url, anonKey, serviceKey }
}

const env = requireEnv()
const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
const admin: Client = createClient<Database>(env.url, env.serviceKey, noSession)
const anonClient = (): Client => createClient<Database>(env.url, env.anonKey, noSession)

const run = Date.now().toString(36)
const password = `Rls-test-${run}!`

/** Unwraps a PostgREST/Storage response: throws on error or missing data. */
function must<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null || result.data === undefined) throw new Error('no data')
  return result.data as NonNullable<T>
}

/** Checks only the error of a response (for RPCs that return void). */
function ok(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message)
}

async function createUser(label: string): Promise<TestUser> {
  const email = `rls-${label}-${run}@biblenote.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const client = anonClient()
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, email, client }
}

async function mySpaces(client: Client) {
  return must(await client.rpc('my_spaces'))
}

async function subscribeStatus(client: Client, topic: string): Promise<string> {
  // Pass the user token explicitly: without it the socket keeps using the anon key.
  const { data } = await client.auth.getSession()
  await client.realtime.setAuth(data.session?.access_token)
  return new Promise((resolve) => {
    const channel = client.channel(topic, { config: { private: true } })
    const finish = (status: string) => {
      clearTimeout(timer)
      resolve(status)
      void client.removeChannel(channel)
    }
    const timer = setTimeout(() => finish('TIMED_OUT'), 10_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        finish(status)
      }
    })
  })
}

let owner: TestUser
let editor: TestUser
let viewer: TestUser
let stranger: TestUser
let guest: { id: string; client: Client }
let spaceA: string
let spaceB: string
let editorLink: Link
let viewerLink: Link
let folderF1: string
let noteN1: string
const cleanup = { users: [] as string[], paths: [] as string[] }

beforeAll(async () => {
  owner = await createUser('owner')
  editor = await createUser('editor')
  viewer = await createUser('viewer')
  stranger = await createUser('stranger')
  cleanup.users.push(owner.id, editor.id, viewer.id, stranger.id)

  const guestClient = anonClient()
  const { data: guestData, error: guestError } = await guestClient.auth.signInAnonymously()
  if (guestError || !guestData.user) {
    throw new Error(
      `Anonymous sign-in failed (${guestError?.message ?? 'no user'}). ` +
        'Enable "Allow anonymous sign-ins" in Supabase > Authentication (see README.md).',
    )
  }
  guest = { id: guestData.user.id, client: guestClient }
  cleanup.users.push(guest.id)

  spaceA = must(
    await owner.client.from('spaces').insert({ owner_id: owner.id, name: 'A' }).select().single(),
  ).id
  spaceB = must(
    await owner.client.from('spaces').insert({ owner_id: owner.id, name: 'B' }).select().single(),
  ).id

  const links = must(
    await owner.client.from('share_links').select('id, role, token').eq('space_id', spaceA),
  )
  const findLink = (role: string): Link => {
    const link = links.find((l) => l.role === role)
    if (!link) throw new Error(`missing ${role} link`)
    return { id: link.id, token: link.token }
  }
  editorLink = findLink('editor')
  viewerLink = findLink('viewer')

  must(
    await editor.client.rpc('join_by_token', { p_token: editorLink.token, p_display_name: 'Ed' }),
  )
  must(
    await viewer.client.rpc('join_by_token', { p_token: viewerLink.token, p_display_name: 'Vi' }),
  )
  must(await guest.client.rpc('join_by_token', { p_token: viewerLink.token, p_display_name: 'Gu' }))
})

afterAll(async () => {
  for (const user of [owner, editor, viewer, stranger, guest]) {
    user?.client.realtime.disconnect()
  }
  if (cleanup.paths.length > 0) {
    await admin.storage.from('files').remove(cleanup.paths)
  }
  for (const id of cleanup.users) {
    await admin.auth.admin.deleteUser(id)
  }
})

describe('access overview', () => {
  it('my_spaces reports each role', async () => {
    const o = await mySpaces(owner.client)
    expect(o).toEqual(
      expect.arrayContaining([
        { id: spaceA, role: 'owner' },
        { id: spaceB, role: 'owner' },
      ]),
    )
    expect(await mySpaces(editor.client)).toEqual([{ id: spaceA, role: 'editor' }])
    expect(await mySpaces(viewer.client)).toEqual([{ id: spaceA, role: 'viewer' }])
    expect(await mySpaces(guest.client)).toEqual([{ id: spaceA, role: 'viewer' }])
    expect(await mySpaces(stranger.client)).toEqual([])
  })

  it('every account may create its own spaces; link guests may not', async () => {
    expect(must(await owner.client.rpc('is_allowed_email'))).toBe(true)
    expect(must(await editor.client.rpc('is_allowed_email'))).toBe(true)
    expect(must(await guest.client.rpc('is_allowed_email'))).toBe(false)

    // A fresh account that was never invited anywhere (2026-10-15: the app is open to anyone).
    const newcomer = await createUser('newcomer')
    cleanup.users.push(newcomer.id)
    const own = must(
      await newcomer.client
        .from('spaces')
        .insert({ owner_id: newcomer.id, name: 'N' })
        .select()
        .single(),
    )
    expect(await mySpaces(newcomer.client)).toEqual([{ id: own.id, role: 'owner' }])
    expect(must(await owner.client.from('spaces').select('id').eq('id', own.id))).toEqual([])
    expect(must(await stranger.client.from('spaces').select('id').eq('id', own.id))).toEqual([])

    const byGuest = await guest.client.from('spaces').insert({ owner_id: guest.id, name: 'X' })
    expect(byGuest.error?.code).toBe('42501')

    const forgedOwner = await editor.client.from('spaces').insert({ owner_id: owner.id, name: 'X' })
    expect(forgedOwner.error?.code).toBe('42501')
  })

  it('ping works with the anon key', async () => {
    expect(typeof must(await anonClient().rpc('ping'))).toBe('string')
  })

  it('profiles are visible only to yourself and to people in your spaces', async () => {
    const seenByEditor = must(await editor.client.from('profiles').select('id'))
    expect(seenByEditor.map((p) => p.id)).toEqual(expect.arrayContaining([editor.id, owner.id]))
    const seenByStranger = must(await stranger.client.from('profiles').select('id'))
    expect(seenByStranger.map((p) => p.id)).toEqual([stranger.id])
  })
})

describe('stranger', () => {
  it('sees nothing and cannot write', async () => {
    expect(must(await stranger.client.from('spaces').select('id'))).toEqual([])
    expect(must(await stranger.client.from('folders').select('id'))).toEqual([])
    expect(must(await stranger.client.from('share_links').select('id'))).toEqual([])
    const insert = await stranger.client
      .from('folders')
      .insert({ space_id: spaceA, name: 'X', created_by: stranger.id })
    expect(insert.error?.code).toBe('42501')
    const join = await stranger.client.rpc('join_by_token', { p_token: 'not-a-token' })
    expect(join.error?.message).toContain('BN_INVALID_LINK')
  })
})

describe('editor', () => {
  it('creates folders and notes', async () => {
    const folder = must(
      await editor.client
        .from('folders')
        .insert({ space_id: spaceA, name: 'F1', created_by: editor.id, updated_by: editor.id })
        .select()
        .single(),
    )
    folderF1 = folder.id

    noteN1 = crypto.randomUUID()
    const result = must(
      await editor.client.rpc('save_note', {
        p_note: { id: noteN1, space_id: spaceA, title: 'N1', content: {}, content_text: 'n1' },
        p_base_version: 0,
      }),
    ) as { status: string; note: { version: number; created_by: string } }
    expect(result.status).toBe('ok')
    expect(result.note.version).toBe(1)
    expect(result.note.created_by).toBe(editor.id)
  })

  it('cannot see tokens, manage links, remove people or purge', async () => {
    expect(must(await editor.client.from('share_links').select('id'))).toEqual([])

    const regen = await editor.client.rpc('regenerate_share_link', { p_link_id: editorLink.id })
    expect(regen.error?.code).toBe('42501')
    const toggle = await editor.client.rpc('set_link_enabled', {
      p_link_id: viewerLink.id,
      p_enabled: false,
    })
    expect(toggle.error?.code).toBe('42501')

    const removed = must(
      await editor.client.from('space_members').delete().eq('user_id', viewer.id).select(),
    )
    expect(removed).toEqual([])

    const purge = must(await editor.client.rpc('purge_items', { p_ids: [noteN1] })) as {
      purged: number
      skipped: string[]
    }
    expect(purge.purged).toBe(0)
    expect(purge.skipped).toEqual([noteN1])
  })

  it('can rename themselves; the owner name lives in profiles', async () => {
    ok(await editor.client.rpc('set_display_name', { p_space_id: spaceA, p_name: 'Editor' }))
    const members = must(await viewer.client.from('space_members').select('user_id, display_name'))
    expect(members).toEqual(
      expect.arrayContaining([{ user_id: editor.id, display_name: 'Editor' }]),
    )
    ok(await owner.client.rpc('set_display_name', { p_space_id: spaceA, p_name: 'Owner' }))
    const profile = must(
      await owner.client.from('profiles').select('display_name').eq('id', owner.id).single(),
    )
    expect(profile.display_name).toBe('Owner')
    ok(await editor.client.rpc('touch_presence'))
  })
})

describe('viewer', () => {
  it('reads but never writes', async () => {
    expect(must(await viewer.client.from('folders').select('id'))).toEqual([{ id: folderF1 }])
    expect(must(await viewer.client.from('notes').select('id'))).toEqual([{ id: noteN1 }])

    const insert = await viewer.client
      .from('folders')
      .insert({ space_id: spaceA, name: 'X', created_by: viewer.id })
    expect(insert.error?.code).toBe('42501')

    const rename = must(
      await viewer.client
        .from('folders')
        .update({ name: 'hacked', updated_by: viewer.id })
        .eq('id', folderF1)
        .select(),
    )
    expect(rename).toEqual([])

    const save = await viewer.client.rpc('save_note', {
      p_note: { id: noteN1, space_id: spaceA, title: 'hacked' },
      p_base_version: 1,
    })
    expect(save.error?.code).toBe('42501')

    const meta = must(
      await viewer.client.from('notes').update({ pinned: true }).eq('id', noteN1).select(),
    )
    expect(meta).toEqual([])
  })
})

describe('save_note', () => {
  it('checks the version and never touches metadata', async () => {
    const v2 = must(
      await editor.client.rpc('save_note', {
        p_note: { id: noteN1, space_id: spaceA, title: 'N1 v2', content: {}, content_text: '' },
        p_base_version: 1,
      }),
    ) as { status: string; note: { version: number } }
    expect(v2.status).toBe('ok')
    expect(v2.note.version).toBe(2)

    const moved = must(
      await owner.client.from('notes').update({ folder_id: folderF1 }).eq('id', noteN1).select(),
    )
    expect(moved).toHaveLength(1)

    const v3 = must(
      await editor.client.rpc('save_note', {
        p_note: { id: noteN1, space_id: spaceA, title: 'N1 v3', folder_id: null, pinned: true },
        p_base_version: 2,
      }),
    ) as { status: string; note: { version: number; folder_id: string | null; pinned: boolean } }
    expect(v3.status).toBe('ok')
    expect(v3.note.version).toBe(3)
    expect(v3.note.folder_id).toBe(folderF1)
    expect(v3.note.pinned).toBe(false)

    const stale = must(
      await editor.client.rpc('save_note', {
        p_note: { id: noteN1, space_id: spaceA, title: 'stale' },
        p_base_version: 1,
      }),
    ) as { status: string; note: { version: number; title: string } }
    expect(stale.status).toBe('conflict')
    expect(stale.note.version).toBe(3)
    expect(stale.note.title).toBe('N1 v3')
  })

  it('direct note updates are limited to metadata columns', async () => {
    const titleUpdate = await editor.client
      .from('notes')
      .update({ title: 'direct' } as never)
      .eq('id', noteN1)
      .select()
    expect(titleUpdate.error?.code).toBe('42501')

    const pin = must(
      await editor.client.from('notes').update({ pinned: true }).eq('id', noteN1).select(),
    )
    expect(pin).toHaveLength(1)
  })

  it('refuses notes from spaces the caller cannot edit', async () => {
    const noteB = crypto.randomUUID()
    must(
      await owner.client.rpc('save_note', {
        p_note: { id: noteB, space_id: spaceB, title: 'B' },
        p_base_version: 0,
      }),
    )
    const attack = await editor.client.rpc('save_note', {
      p_note: { id: noteB, space_id: spaceA, title: 'hacked' },
      p_base_version: 1,
    })
    expect(attack.error?.code).toBe('42501')
    const untouched = must(
      await owner.client.from('notes').select('title').eq('id', noteB).single(),
    )
    expect(untouched.title).toBe('B')
  })
})

describe('integrity triggers', () => {
  it('space_id is immutable', async () => {
    const move = await editor.client
      .from('folders')
      .update({ space_id: spaceB, updated_by: editor.id } as never)
      .eq('id', folderF1)
      .select()
    expect(move.error).not.toBeNull()
  })

  it('folder references must be in the same space and not in the trash', async () => {
    const folderB = must(
      await owner.client
        .from('folders')
        .insert({ space_id: spaceB, name: 'FB', created_by: owner.id, updated_by: owner.id })
        .select()
        .single(),
    ).id

    const crossSpace = await editor.client.rpc('save_note', {
      p_note: { id: crypto.randomUUID(), space_id: spaceA, folder_id: folderB, title: 'x' },
      p_base_version: 0,
    })
    expect(crossSpace.error?.message).toContain('BN_FOLDER_NOT_IN_SPACE')

    const crossParent = await editor.client
      .from('folders')
      .insert({ space_id: spaceA, parent_id: folderB, name: 'X', created_by: editor.id })
    expect(crossParent.error?.message).toContain('BN_FOLDER_NOT_IN_SPACE')

    const trashed = must(
      await owner.client
        .from('folders')
        .insert({ space_id: spaceA, name: 'F2', created_by: owner.id, updated_by: owner.id })
        .select()
        .single(),
    ).id
    must(
      await owner.client
        .from('folders')
        .update({ deleted_at: new Date().toISOString(), updated_by: owner.id })
        .eq('id', trashed)
        .select(),
    )
    const intoTrash = await editor.client
      .from('notes')
      .update({ folder_id: trashed })
      .eq('id', noteN1)
      .select()
    expect(intoTrash.error?.message).toContain('BN_FOLDER_DELETED')
  })

  it('folders cannot form cycles', async () => {
    const child = must(
      await editor.client
        .from('folders')
        .insert({
          space_id: spaceA,
          parent_id: folderF1,
          name: 'F3',
          created_by: editor.id,
          updated_by: editor.id,
        })
        .select()
        .single(),
    ).id
    const cycle = await editor.client
      .from('folders')
      .update({ parent_id: child, updated_by: editor.id })
      .eq('id', folderF1)
      .select()
    expect(cycle.error?.message).toContain('BN_FOLDER_CYCLE')
  })

  it('storage_path must be {space_id}/{id}', async () => {
    const fileId = crypto.randomUUID()
    const wrong = await editor.client.from('files').insert({
      id: fileId,
      space_id: spaceA,
      name: 'a.txt',
      kind: 'document',
      mime: 'text/plain',
      size_bytes: 1,
      storage_path: `${spaceB}/${fileId}`,
      created_by: editor.id,
    })
    expect(wrong.error?.message).toContain('BN_BAD_STORAGE_PATH')
  })
})

describe('purge', () => {
  it('owner purges trashed items; purged rows are frozen tombstones', async () => {
    const noteN2 = crypto.randomUUID()
    must(
      await editor.client.rpc('save_note', {
        p_note: { id: noteN2, space_id: spaceA, title: 'N2', content_text: 'secret' },
        p_base_version: 0,
      }),
    )
    const notTrashed = must(await owner.client.rpc('purge_items', { p_ids: [noteN2] })) as {
      purged: number
    }
    expect(notTrashed.purged).toBe(0)

    must(
      await editor.client
        .from('notes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', noteN2)
        .select(),
    )
    const purged = must(await owner.client.rpc('purge_items', { p_ids: [noteN2] })) as {
      purged: number
    }
    expect(purged.purged).toBe(1)

    const tombstone = must(
      await viewer.client
        .from('notes')
        .select('title, content_text, purged_at')
        .eq('id', noteN2)
        .single(),
    )
    expect(tombstone.purged_at).not.toBeNull()
    expect(tombstone.title).toBe('')
    expect(tombstone.content_text).toBe('')

    const metaAfter = must(
      await editor.client.from('notes').update({ pinned: true }).eq('id', noteN2).select(),
    )
    expect(metaAfter).toEqual([])

    const saveAfter = must(
      await editor.client.rpc('save_note', {
        p_note: { id: noteN2, space_id: spaceA, title: 'revive' },
        p_base_version: 1,
      }),
    ) as { status: string }
    expect(saveAfter.status).toBe('gone')
  })
})

describe('storage', () => {
  it('editors upload, viewers download, only the owner deletes', async () => {
    const fileId = crypto.randomUUID()
    const path = `${spaceA}/${fileId}`
    cleanup.paths.push(path)

    const upload = await editor.client.storage
      .from('files')
      .upload(path, new Blob(['hello']), { contentType: 'text/plain' })
    expect(upload.error).toBeNull()
    expect(must(await owner.client.rpc('storage_usage'))).toBeGreaterThanOrEqual(5)

    const viewerUrl = await viewer.client.storage.from('files').createSignedUrl(path, 60)
    expect(viewerUrl.error).toBeNull()
    expect(viewerUrl.data?.signedUrl).toContain('/files/')

    const strangerUrl = await stranger.client.storage.from('files').createSignedUrl(path, 60)
    expect(strangerUrl.error).not.toBeNull()

    const viewerUpload = await viewer.client.storage
      .from('files')
      .upload(`${spaceA}/${crypto.randomUUID()}`, new Blob(['x']))
    expect(viewerUpload.error).not.toBeNull()

    const badPath = await editor.client.storage
      .from('files')
      .upload(`not-a-space/${fileId}`, new Blob(['x']))
    expect(badPath.error).not.toBeNull()

    await editor.client.storage.from('files').remove([path])
    const stillThere = must(await admin.storage.from('files').list(spaceA))
    expect(stillThere.map((o) => o.name)).toContain(fileId)

    const ownerRemove = await owner.client.storage.from('files').remove([path])
    expect(ownerRemove.error).toBeNull()
    const gone = must(await admin.storage.from('files').list(spaceA))
    expect(gone.map((o) => o.name)).not.toContain(fileId)
  })
})

describe('realtime', () => {
  it('private space channels admit members only', async () => {
    expect(await subscribeStatus(viewer.client, `space:${spaceA}`)).toBe('SUBSCRIBED')
    expect(await subscribeStatus(stranger.client, `space:${spaceA}`)).not.toBe('SUBSCRIBED')
  })
})

describe('column privileges', () => {
  it('editors cannot set purged_at, created_by or size_bytes on folders and files', async () => {
    const stamp = new Date().toISOString()

    const folderPurge = await editor.client
      .from('folders')
      .update({ purged_at: stamp, updated_by: editor.id } as never)
      .eq('id', folderF1)
      .select()
    expect(folderPurge.error?.code).toBe('42501')

    const folderCreator = await editor.client
      .from('folders')
      .update({ created_by: editor.id, updated_by: editor.id } as never)
      .eq('id', folderF1)
      .select()
    expect(folderCreator.error?.code).toBe('42501')

    const folderInsertPurged = await editor.client
      .from('folders')
      .insert({ space_id: spaceA, name: 'X', created_by: editor.id, purged_at: stamp } as never)
      .select()
    expect(folderInsertPurged.error?.code).toBe('42501')

    const fileId = crypto.randomUUID()
    must(
      await editor.client
        .from('files')
        .insert({
          id: fileId,
          space_id: spaceA,
          name: 'a.txt',
          kind: 'document',
          mime: 'text/plain',
          size_bytes: 1,
          storage_path: `${spaceA}/${fileId}`,
          created_by: editor.id,
        })
        .select(),
    )
    const filePurge = await editor.client
      .from('files')
      .update({ purged_at: stamp } as never)
      .eq('id', fileId)
      .select()
    expect(filePurge.error?.code).toBe('42501')
    const fileCreator = await editor.client
      .from('files')
      .update({ created_by: owner.id } as never)
      .eq('id', fileId)
      .select()
    expect(fileCreator.error?.code).toBe('42501')
    const fileSize = await editor.client
      .from('files')
      .update({ size_bytes: 0 } as never)
      .eq('id', fileId)
      .select()
    expect(fileSize.error?.code).toBe('42501')
    const fileInsertPurged = await editor.client
      .from('files')
      .insert({
        id: crypto.randomUUID(),
        space_id: spaceA,
        name: 'b.txt',
        kind: 'document',
        mime: 'text/plain',
        size_bytes: 1,
        storage_path: `${spaceA}/${crypto.randomUUID()}`,
        created_by: editor.id,
        purged_at: stamp,
      } as never)
      .select()
    expect(fileInsertPurged.error?.code).toBe('42501')

    const spacePurge = await owner.client
      .from('spaces')
      .update({ purged_at: stamp } as never)
      .eq('id', spaceA)
      .select()
    expect(spacePurge.error?.code).toBe('42501')

    const renamed = must(
      await editor.client.from('files').update({ name: 'renamed.txt' }).eq('id', fileId).select(),
    )
    expect(renamed).toHaveLength(1)
  })

  it('internal helpers are not callable as RPCs', async () => {
    const args = { p_folder_id: folderF1, p_space_id: spaceA } as never
    const asAnon = await anonClient().rpc('assert_folder_usable' as never, args)
    expect(asAnon.error?.code).toBe('42501')
    const asEditor = await editor.client.rpc('assert_folder_usable' as never, args)
    expect(asEditor.error?.code).toBe('42501')
  })
})

describe('save_note idempotency', () => {
  it('returns ok for an identical payload, whatever the version', async () => {
    const same = { id: noteN1, space_id: spaceA, title: 'N1 v3' }
    const before = must(
      await editor.client.from('notes').select('version').eq('id', noteN1).single(),
    ).version

    const repeat = must(
      await editor.client.rpc('save_note', { p_note: same, p_base_version: 1 }),
    ) as { status: string; note: { version: number } }
    expect(repeat.status).toBe('ok')
    expect(repeat.note.version).toBe(before)

    const nullVersionSame = must(
      await editor.client.rpc('save_note', { p_note: same, p_base_version: null }),
    ) as { status: string }
    expect(nullVersionSame.status).toBe('ok')

    const nullVersionChanged = must(
      await editor.client.rpc('save_note', {
        p_note: { ...same, title: 'N1 v4' },
        p_base_version: null,
      }),
    ) as { status: string; note: { title: string; version: number } }
    expect(nullVersionChanged.status).toBe('conflict')
    expect(nullVersionChanged.note.title).toBe('N1 v3')
    expect(nullVersionChanged.note.version).toBe(before)
  })
})

/** A new guest without an account, as on a share link (cleaned up at the end). */
async function newGuest(): Promise<{ id: string; client: Client }> {
  const client = anonClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw new Error(error?.message ?? 'anonymous sign-in failed')
  cleanup.users.push(data.user.id)
  return { id: data.user.id, client }
}

/** Joins the private channel of a space; resolves once subscribed. */
async function joinChannel(
  client: Client,
  topic: string,
  setup: (channel: RealtimeChannel) => void = () => undefined,
): Promise<RealtimeChannel> {
  const { data } = await client.auth.getSession()
  await client.realtime.setAuth(data.session?.access_token)
  const channel = client.channel(topic, {
    config: { private: true, broadcast: { self: false } },
  })
  setup(channel)
  // Presence is enabled on a channel only when a presence listener exists before subscribing
  // (the app's realtime hub registers one on every space channel).
  channel.on('presence', { event: 'sync' }, () => undefined)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${topic}: not subscribed`)), 10_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(new Error(`${topic}: ${status}`))
      }
    })
  })
  return channel
}

/** Polls until `check` holds or the time is up; returns the last result. */
async function eventually(check: () => boolean, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return check()
}

describe('sharing (phase 4)', () => {
  it('a guest from the viewer link reads the space but never writes', async () => {
    expect(must(await guest.client.from('notes').select('id'))).toEqual(
      expect.arrayContaining([{ id: noteN1 }]),
    )
    expect(must(await guest.client.from('share_links').select('id'))).toEqual([])

    const folder = await guest.client
      .from('folders')
      .insert({ space_id: spaceA, name: 'X', created_by: guest.id })
    expect(folder.error?.code).toBe('42501')
    const note = await guest.client.rpc('save_note', {
      p_note: { id: crypto.randomUUID(), space_id: spaceA, title: 'X', content: {} },
      p_base_version: null,
    })
    expect(note.error?.code).toBe('42501')
    const upload = await guest.client.storage
      .from('files')
      .upload(`${spaceA}/${crypto.randomUUID()}`, new Blob(['x']))
    expect(upload.error).not.toBeNull()
  })

  it('a guest from the editor link writes; opening the viewer link later keeps editor', async () => {
    const g = await newGuest()
    must(await g.client.rpc('join_by_token', { p_token: viewerLink.token, p_display_name: 'G2' }))
    expect(await mySpaces(g.client)).toEqual([{ id: spaceA, role: 'viewer' }])
    must(await g.client.rpc('join_by_token', { p_token: editorLink.token }))
    must(await g.client.rpc('join_by_token', { p_token: viewerLink.token }))
    expect(await mySpaces(g.client)).toEqual([{ id: spaceA, role: 'editor' }])

    const saved = must(
      await g.client.rpc('save_note', {
        p_note: { id: crypto.randomUUID(), space_id: spaceA, title: 'De la invitat', content: {} },
        p_base_version: null,
      }),
    ) as { status: string; note: { created_by: string } }
    expect(saved.status).toBe('ok')
    expect(saved.note.created_by).toBe(g.id)
    // The name given on the first link stays when later links come without one.
    const me = must(
      await g.client.from('space_members').select('display_name, role').eq('user_id', g.id),
    )
    expect(me).toEqual([{ display_name: 'G2', role: 'editor' }])
  })

  it('the owner opening their own link stays owner, without a member row', async () => {
    const joined = must(await owner.client.rpc('join_by_token', { p_token: editorLink.token })) as {
      role: string
      space_id: string
    }
    expect(joined).toMatchObject({ role: 'owner', space_id: spaceA })
    expect(must(await admin.from('space_members').select('id').eq('user_id', owner.id))).toEqual([])
  })

  it('names are cut at 60 characters; members see names and last visits, strangers nothing', async () => {
    const g = await newGuest()
    must(
      await g.client.rpc('join_by_token', {
        p_token: viewerLink.token,
        p_display_name: 'N'.repeat(80),
      }),
    )
    const seen = must(
      await viewer.client.from('space_members').select('user_id, display_name, last_seen_at'),
    )
    const row = seen.find((m) => m.user_id === g.id)
    expect(row?.display_name).toHaveLength(60)
    expect(row?.last_seen_at).not.toBeNull()
    expect(seen.map((m) => m.user_id)).toEqual(expect.arrayContaining([editor.id, guest.id]))
    expect(must(await stranger.client.from('space_members').select('id'))).toEqual([])
  })

  it('the owner removes a person, who loses access at once; members cannot remove anyone', async () => {
    const g = await newGuest()
    must(await g.client.rpc('join_by_token', { p_token: viewerLink.token, p_display_name: 'G4' }))
    const [member] = must(await owner.client.from('space_members').select('id').eq('user_id', g.id))

    const self = must(await g.client.from('space_members').delete().eq('user_id', g.id).select())
    expect(self).toEqual([])
    const byEditor = must(
      await editor.client.from('space_members').delete().eq('user_id', g.id).select(),
    )
    expect(byEditor).toEqual([])

    const removed = must(
      await owner.client
        .from('space_members')
        .delete()
        .eq('id', member?.id ?? '')
        .select('id'),
    )
    expect(removed).toHaveLength(1)
    expect(await mySpaces(g.client)).toEqual([])
    expect(must(await g.client.from('notes').select('id'))).toEqual([])
    expect(await subscribeStatus(g.client, `space:${spaceA}`)).not.toBe('SUBSCRIBED')
  })

  it('a link turned off without removing people keeps their access, but lets nobody in', async () => {
    must(
      await owner.client.rpc('set_link_enabled', {
        p_link_id: viewerLink.id,
        p_enabled: false,
        p_remove_members: false,
      }),
    )
    expect(await mySpaces(viewer.client)).toEqual([{ id: spaceA, role: 'viewer' }])
    const g = await newGuest()
    const join = await g.client.rpc('join_by_token', { p_token: viewerLink.token })
    expect(join.error?.message).toContain('BN_INVALID_LINK')
    must(await owner.client.rpc('set_link_enabled', { p_link_id: viewerLink.id, p_enabled: true }))
  })

  it('presence: a viewer is seen with the note it has open, but cannot broadcast', async () => {
    const received: string[] = []
    let ownerChannel: RealtimeChannel | null = null
    ownerChannel = await joinChannel(owner.client, `space:${spaceA}`, (channel) => {
      channel.on('broadcast', { event: 'changed' }, ({ payload }) =>
        received.push(String((payload as { by?: string }).by)),
      )
    })
    const viewerChannel = await joinChannel(viewer.client, `space:${spaceA}`)
    const editorChannel = await joinChannel(editor.client, `space:${spaceA}`)
    try {
      expect(await viewerChannel.track({ user_id: viewer.id, name: 'Vi', note_id: noteN1 })).toBe(
        'ok',
      )
      const seen = await eventually(() =>
        Object.values(ownerChannel?.presenceState() ?? {})
          .flat()
          .some((p) => (p as { user_id?: string }).user_id === viewer.id),
      )
      expect(seen).toBe(true)

      await viewerChannel.send({ type: 'broadcast', event: 'changed', payload: { by: 'viewer' } })
      await editorChannel.send({ type: 'broadcast', event: 'changed', payload: { by: 'editor' } })
      // The editor's message arrives; the viewer's never does.
      expect(await eventually(() => received.includes('editor'))).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(received).not.toContain('viewer')
    } finally {
      for (const [client, channel] of [
        [owner.client, ownerChannel],
        [viewer.client, viewerChannel],
        [editor.client, editorChannel],
      ] as const) {
        if (channel) await client.removeChannel(channel)
      }
    }
  })
})

const DAY_MS = 24 * 60 * 60 * 1000

/** A note in space A, already in the trash. */
async function trashedNote(title: string): Promise<string> {
  const id = crypto.randomUUID()
  must(
    await editor.client.rpc('save_note', {
      p_note: { id, space_id: spaceA, title },
      p_base_version: null,
    }),
  )
  must(
    await editor.client
      .from('notes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select(),
  )
  return id
}

/** A file in space A (object and row) uploaded by the owner. */
async function ownerFile(folderId: string | null = null): Promise<{ id: string; path: string }> {
  const id = crypto.randomUUID()
  const path = `${spaceA}/${id}`
  cleanup.paths.push(path)
  ok(await owner.client.storage.from('files').upload(path, new Blob(['x']), { upsert: false }))
  must(
    await owner.client
      .from('files')
      .insert({
        id,
        space_id: spaceA,
        folder_id: folderId,
        name: 'F',
        kind: 'document',
        mime: 'text/plain',
        size_bytes: 1,
        storage_path: path,
        created_by: owner.id,
      })
      .select(),
  )
  return { id, path }
}

describe('trash (phase 6)', () => {
  it("trashed_at is the server's time, whatever deleted_at says; clients cannot set it", async () => {
    const folderId = crypto.randomUUID()
    must(
      await editor.client
        .from('folders')
        .insert({ id: folderId, space_id: spaceA, name: 'T', created_by: editor.id })
        .select(),
    )
    const yearAgo = new Date(Date.now() - 365 * DAY_MS).toISOString()
    const [row] = must(
      await editor.client
        .from('folders')
        .update({ deleted_at: yearAgo, updated_by: editor.id })
        .eq('id', folderId)
        .select('deleted_at, trashed_at'),
    )
    expect(Date.parse(row?.deleted_at ?? '')).toBe(Date.parse(yearAgo))
    expect(Math.abs(Date.parse(row?.trashed_at ?? '') - Date.now())).toBeLessThan(10 * 60_000)

    // A column privilege, not the update policy: the same update without it goes through.
    for (const user of [editor, owner]) {
      const direct = await user.client
        .from('folders')
        .update({ trashed_at: yearAgo, updated_by: user.id } as never)
        .eq('id', folderId)
        .select()
      expect(direct.error?.message).toContain('permission denied')
      must(
        await user.client
          .from('folders')
          .update({ updated_by: user.id })
          .eq('id', folderId)
          .select(),
      )
    }
    const [restored] = must(
      await editor.client
        .from('folders')
        .update({ deleted_at: null, updated_by: editor.id })
        .eq('id', folderId)
        .select('trashed_at'),
    )
    expect(restored?.trashed_at).toBeNull()
  })

  it("purge_expired empties only the caller's own items, 30 days after trashed_at", async () => {
    const old = await trashedNote('Old')
    const recent = await trashedNote('Recent')
    // Thirty-one days in the trash, as only the service role can write it.
    must(
      await admin
        .from('notes')
        .update({ trashed_at: new Date(Date.now() - 31 * DAY_MS).toISOString() } as never)
        .eq('id', old)
        .select(),
    )

    for (const client of [editor.client, viewer.client, stranger.client]) {
      const result = must(await client.rpc('purge_expired')) as { purged: number }
      expect(result.purged).toBe(0)
    }
    expect(
      must(await admin.from('notes').select('purged_at').eq('id', old).single()).purged_at,
    ).toBeNull()

    const result = must(await owner.client.rpc('purge_expired')) as { purged: number }
    expect(result.purged).toBe(1)
    const rows = must(await admin.from('notes').select('id, purged_at').in('id', [old, recent]))
    expect(rows.find((r) => r.id === old)?.purged_at).not.toBeNull()
    expect(rows.find((r) => r.id === recent)?.purged_at).toBeNull()
  })

  it('purge_items lists the objects of the files it purged, also through a folder', async () => {
    const folderId = crypto.randomUUID()
    must(
      await owner.client
        .from('folders')
        .insert({ id: folderId, space_id: spaceA, name: 'P', created_by: owner.id })
        .select(),
    )
    const loose = await ownerFile()
    const inside = await ownerFile(folderId)
    const stamp = new Date().toISOString()
    must(await owner.client.from('files').update({ deleted_at: stamp }).eq('id', loose.id).select())
    must(
      await owner.client
        .from('folders')
        .update({ deleted_at: stamp, updated_by: owner.id })
        .eq('id', folderId)
        .select(),
    )

    const result = must(await owner.client.rpc('purge_items', { p_ids: [loose.id, folderId] })) as {
      purged: number
      paths: string[]
    }
    expect(result.purged).toBe(2)
    expect([...result.paths].sort()).toEqual([loose.path, inside.path].sort())
    ok(await owner.client.storage.from('files').remove(result.paths))
  })

  it("the owner lists a space's objects page by page, with their creation time", async () => {
    const files = [await ownerFile(), await ownerFile(), await ownerFile()]
    const names = new Set(files.map((f) => f.id))
    const seen: { name: string; created_at: string | null }[] = []
    for (let offset = 0; ; offset += 2) {
      const page = must(
        await owner.client.storage
          .from('files')
          .list(spaceA, { limit: 2, offset, sortBy: { column: 'name', order: 'asc' } }),
      )
      seen.push(...page)
      if (page.length < 2) break
    }
    const ours = seen.filter((o) => names.has(o.name))
    expect(ours).toHaveLength(3)
    expect(ours.every((o) => o.created_at !== null)).toBe(true)
    expect(must(await stranger.client.storage.from('files').list(spaceA))).toEqual([])
  })
})

describe('link management (owner)', () => {
  it('disabling a link can remove the people who used it', async () => {
    const disabled = must(
      await owner.client.rpc('set_link_enabled', {
        p_link_id: viewerLink.id,
        p_enabled: false,
        p_remove_members: true,
      }),
    ) as { enabled: boolean }
    expect(disabled.enabled).toBe(false)

    expect(await mySpaces(viewer.client)).toEqual([])
    expect(must(await viewer.client.from('spaces').select('id'))).toEqual([])
    expect(await mySpaces(guest.client)).toEqual([])
    expect(await mySpaces(editor.client)).toEqual([{ id: spaceA, role: 'editor' }])

    const joinDisabled = await stranger.client.rpc('join_by_token', { p_token: viewerLink.token })
    expect(joinDisabled.error?.message).toContain('BN_INVALID_LINK')

    must(await owner.client.rpc('set_link_enabled', { p_link_id: viewerLink.id, p_enabled: true }))
    must(await stranger.client.rpc('join_by_token', { p_token: viewerLink.token }))
    expect(await mySpaces(stranger.client)).toEqual([{ id: spaceA, role: 'viewer' }])
  })

  it('regenerating a link invalidates the old token', async () => {
    const oldToken = editorLink.token
    const regenerated = must(
      await owner.client.rpc('regenerate_share_link', { p_link_id: editorLink.id }),
    ) as { token: string }
    expect(regenerated.token).not.toBe(oldToken)
    expect(regenerated.token.length).toBeGreaterThanOrEqual(43)

    const joinOld = await stranger.client.rpc('join_by_token', { p_token: oldToken })
    expect(joinOld.error?.message).toContain('BN_INVALID_LINK')
    expect(await mySpaces(editor.client)).toEqual([{ id: spaceA, role: 'editor' }])

    must(
      await owner.client.rpc('regenerate_share_link', {
        p_link_id: editorLink.id,
        p_remove_members: true,
      }),
    )
    expect(await mySpaces(editor.client)).toEqual([])
    expect(must(await editor.client.from('notes').select('id'))).toEqual([])
  })
})
