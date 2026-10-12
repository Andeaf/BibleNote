import { describe, expect, it } from 'vitest'
import type { FileRow, FolderRow, NoteRow, SpaceRow } from '@/lib/database.types'
import { buildExportPlan, safeName } from './plan'

const T = '2026-01-01T00:00:00.000Z'
const base = { created_at: T, updated_at: T, deleted_at: null, purged_at: null }
const space = (id: string, name: string, extra: Partial<SpaceRow> = {}): SpaceRow => ({
  ...base,
  id,
  owner_id: 'u',
  name,
  color: null,
  emoji: null,
  ...extra,
})
const folder = (
  id: string,
  name: string,
  parent: string | null,
  extra: Partial<FolderRow> = {},
): FolderRow => ({
  ...base,
  id,
  space_id: 's1',
  parent_id: parent,
  name,
  color: null,
  emoji: null,
  created_by: null,
  updated_by: null,
  ...extra,
})
const note = (
  id: string,
  title: string,
  folderId: string | null,
  extra: Partial<NoteRow> = {},
): NoteRow => ({
  ...base,
  id,
  space_id: 's1',
  folder_id: folderId,
  title,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
  },
  content_text: 'x',
  tags: [],
  pinned: false,
  version: 1,
  created_by: null,
  updated_by: null,
  ...extra,
})
const file = (id: string, name: string, folderId: string | null, size: number): FileRow => ({
  ...base,
  id,
  space_id: 's1',
  folder_id: folderId,
  name,
  kind: 'image',
  mime: 'image/jpeg',
  size_bytes: size,
  storage_path: `s1/${id}`,
  duration_sec: null,
  created_by: null,
})

const source = {
  spaces: [space('s1', 'Studiu'), space('s2', 'Vechi', { deleted_at: T })],
  folders: [
    folder('f1', 'Romani', null),
    folder('f2', '8', 'f1'),
    folder('f3', 'Coș', null, { deleted_at: T }),
    folder('f4', 'Note', null),
  ],
  notes: [
    note('n1', 'Har', null),
    note('n2', 'Har', null),
    note('n3', 'har', null),
    note('n4', 'Ce/este: har?', 'f2'),
    note('n5', '', 'f1'),
    note('n6', 'În coș', null, { deleted_at: T }),
    note('n7', 'În folderul din coș', 'f3'),
    note('n8', 'În folderul principal din coș', null, { space_id: 's2' }),
    note('n9', 'Note', null),
  ],
  files: [file('p1', 'Poza', 'f1', 1000), file('p2', 'Poza.jpg', 'f1', 2000)],
}

describe('the export', () => {
  it('folders as folders, notes as Markdown, files by name; nothing from the trash', () => {
    const plan = buildExportPlan(source, { files: true, untitled: 'Fără titlu' })
    expect(plan.entries.map((e) => e.path).sort()).toEqual([
      'Studiu/Har (2).md',
      'Studiu/Har.md',
      'Studiu/Note.md',
      'Studiu/Romani/8/Ce-este- har-.md',
      'Studiu/Romani/Fără titlu.md',
      'Studiu/Romani/Poza (2).jpg',
      'Studiu/Romani/Poza.jpg',
      'Studiu/har (3).md',
    ])
    expect([plan.notes, plan.files]).toEqual([6, 2])
    // The size is known before anything is downloaded: contents plus ZIP headers.
    const contents = plan.entries.reduce((sum, e) => sum + e.size, 0)
    expect(plan.bytes).toBeGreaterThan(contents)
    expect(plan.bytes).toBeLessThan(contents + 2000)
  })

  it('only the notes', () => {
    const plan = buildExportPlan(source, { files: false, untitled: 'Fără titlu' })
    expect(plan.files).toBe(0)
    expect(plan.entries.every((e) => e.kind === 'note')).toBe(true)
  })

  it('names every system accepts', () => {
    expect(safeName('a\\b/c:d*e?f"g<h>i|j', 'x')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(safeName('  Titlu.  ', 'x')).toBe('Titlu')
    expect(safeName('...', 'Fără titlu')).toBe('Fără titlu')
    expect(safeName('a'.repeat(300), 'x')).toHaveLength(120)
  })
})
