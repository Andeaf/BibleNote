import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileRow, FolderRow, NoteRow, SpaceRow } from '@/lib/database.types'
import { BibleNoteDb } from '@/lib/db'
import { restoreFile } from './files'
import { restoreFolder, trashFolder } from './folders'
import { restoreNote, trashNote } from './notes'
import { collectTrash, daysLeft } from './trash'

const USER = 'user-1'
const T = '2026-01-01T00:00:00.000Z'
const DAY = 24 * 60 * 60 * 1000

const space = (id: string, extra: Partial<SpaceRow> = {}): SpaceRow => ({
  id,
  owner_id: USER,
  name: `S-${id}`,
  color: null,
  emoji: null,
  created_at: T,
  updated_at: T,
  deleted_at: null,
  purged_at: null,
  ...extra,
})
const folder = (id: string, parent: string | null, extra: Partial<FolderRow> = {}): FolderRow => ({
  id,
  space_id: 's1',
  parent_id: parent,
  name: `F-${id}`,
  color: null,
  emoji: null,
  created_by: USER,
  updated_by: USER,
  created_at: T,
  updated_at: T,
  deleted_at: null,
  purged_at: null,
  ...extra,
})
const note = (id: string, folderId: string | null, extra: Partial<NoteRow> = {}): NoteRow => ({
  id,
  space_id: 's1',
  folder_id: folderId,
  title: `N-${id}`,
  content: {},
  content_text: 'x',
  tags: [],
  pinned: false,
  version: 1,
  created_by: USER,
  updated_by: USER,
  created_at: T,
  updated_at: T,
  deleted_at: null,
  purged_at: null,
  ...extra,
})
const file = (id: string, folderId: string | null, extra: Partial<FileRow> = {}): FileRow => ({
  id,
  space_id: 's1',
  folder_id: folderId,
  name: `P-${id}`,
  kind: 'image',
  mime: 'image/jpeg',
  size_bytes: 1,
  storage_path: `s1/${id}`,
  duration_sec: null,
  created_by: USER,
  created_at: T,
  updated_at: T,
  deleted_at: null,
  purged_at: null,
  ...extra,
})

describe('the trash list', () => {
  it('shows only what is not inside something else in the trash, newest first', () => {
    const at = (days: number) => new Date(Date.parse(T) + days * DAY).toISOString()
    const items = collectTrash({
      spaces: [space('s1'), space('s2', { deleted_at: at(3) })],
      folders: [
        folder('a', null, { deleted_at: at(1) }),
        folder('b', 'a', { deleted_at: at(1) }),
        folder('c', null),
      ],
      notes: [
        note('n1', 'b', { deleted_at: at(1) }), // inside a trashed folder
        note('n2', 'c', { deleted_at: at(2) }), // alone
        note('n3', null, { space_id: 's2', deleted_at: at(3) }), // inside a trashed space
        note('n4', 'c'), // not in the trash
      ],
      files: [
        file('p1', 'c', { deleted_at: at(0) }),
        file('p2', null, { purged_at: at(0), deleted_at: at(0) }),
      ],
      roles: new Map([
        ['s1', 'editor'],
        ['s2', 'owner'],
      ]),
    })
    expect(items.map((i) => [i.kind, i.id, i.path.join(' / '), i.role])).toEqual([
      ['space', 's2', '', 'owner'],
      ['note', 'n2', 'S-s1 / F-c', 'editor'],
      ['folder', 'a', 'S-s1', 'editor'],
      ['file', 'p1', 'S-s1 / F-c', 'editor'],
    ])
  })

  it('counts the days left of the 30', () => {
    expect(daysLeft(T, Date.parse(T))).toBe(30)
    expect(daysLeft(T, Date.parse(T) + 29.5 * DAY)).toBe(1)
    expect(daysLeft(T, Date.parse(T) + 31 * DAY)).toBe(0)
  })
})

describe('restoring', () => {
  let db: BibleNoteDb
  beforeEach(async () => {
    db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
    await db.spaces.put(space('s1'))
    await db.folders.bulkPut([folder('a', null), folder('b', 'a')])
    await db.notes.bulkPut([note('n1', 'b'), note('n2', 'a'), note('n3', null)])
    await db.files.put(file('p1', 'a'))
  })
  afterEach(() => db.close())

  it('a folder brings back what went to the trash with it, not what was trashed earlier', async () => {
    await trashNote(db, 'n2') // earlier, on its own
    await trashFolder(db, USER, 'a')
    await restoreFolder(db, USER, 'a')
    const deleted = async () => ({
      folders: (await db.folders.toArray()).filter((f) => f.deleted_at).map((f) => f.id),
      notes: (await db.notes.toArray()).filter((n) => n.deleted_at).map((n) => n.id),
      files: (await db.files.toArray()).filter((f) => f.deleted_at).map((f) => f.id),
    })
    expect(await deleted()).toEqual({ folders: [], notes: ['n2'], files: [] })
    // The server gets deleted_at null for each restored row (merged into the trash entries).
    const entries = await db.outbox.toArray()
    const restored = entries.filter((e) => e.payload.deleted_at === null).map((e) => e.row_id)
    expect(restored.sort()).toEqual(['a', 'b', 'n1', 'p1'])
  })

  it('a note and a file come back on their own', async () => {
    await trashNote(db, 'n3')
    await restoreNote(db, 'n3')
    await db.files.update('p1', { deleted_at: T })
    await restoreFile(db, 'p1')
    expect((await db.notes.get('n3'))?.deleted_at).toBeNull()
    expect((await db.files.get('p1'))?.deleted_at).toBeNull()
  })
})
