import { predictLength } from 'client-zip'
import type { FileRow, FolderRow, NoteRow, SpaceRow } from '@/lib/database.types'
import { downloadName } from '@/lib/files'
import { noteToMarkdown } from './markdown'

/** One file of the ZIP: a note as Markdown, or a stored file. */
export type ExportEntry =
  | { kind: 'note'; id: string; path: string; text: string; size: number; lastModified: Date }
  | {
      kind: 'file'
      id: string
      path: string
      storagePath: string
      size: number
      lastModified: Date
    }

export interface ExportPlan {
  entries: ExportEntry[]
  notes: number
  files: number
  /** The exact size of the ZIP (client-zip stores without compression). */
  bytes: number
}

export interface ExportSource {
  spaces: SpaceRow[]
  folders: FolderRow[]
  notes: NoteRow[]
  files: FileRow[]
}

const MAX_NAME = 120
const encoder = new TextEncoder()

/** A name every system accepts: no path or reserved characters, no trailing dots or spaces. */
export function safeName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME)
    .trim()
  return cleaned || fallback
}

/** "Nume.md", "Nume (2).md"… unique in its folder, ignoring case (Windows, macOS). */
function uniqueIn(taken: Set<string>, name: string): string {
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let candidate = name
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`
  taken.add(candidate.toLowerCase())
  return candidate
}

/**
 * What "Exportă tot" (or only the notes) puts in the ZIP: every main folder
 * as a top folder, its subfolders inside, notes as Markdown and files with their names. Nothing
 * from the trash. Folder names come first in each folder, so a note never takes a folder's name.
 */
export function buildExportPlan(
  { spaces, folders, notes, files }: ExportSource,
  options: { files: boolean; untitled: string },
): ExportPlan {
  const live = <T extends { deleted_at: string | null; purged_at: string | null }>(rows: T[]) =>
    rows.filter((row) => !row.deleted_at && !row.purged_at)
  const liveSpaces = live(spaces).sort((a, b) => a.name.localeCompare(b.name, 'ro'))
  const liveFolders = live(folders)
  const folderById = new Map(liveFolders.map((f) => [f.id, f]))
  const taken = new Map<string, Set<string>>()
  const takenIn = (dir: string) => {
    let set = taken.get(dir)
    if (!set) taken.set(dir, (set = new Set()))
    return set
  }

  // Directory of every reachable folder, parents first.
  const dirs = new Map<string, string>()
  const rootOf = new Map<string, string>()
  for (const space of liveSpaces) {
    rootOf.set(space.id, uniqueIn(takenIn(''), safeName(space.name, options.untitled)))
  }
  const dirOf = (folder: FolderRow): string | null => {
    const known = dirs.get(folder.id)
    if (known !== undefined) return known
    const root = rootOf.get(folder.space_id)
    if (root === undefined) return null
    const parent = folder.parent_id ? folderById.get(folder.parent_id) : null
    if (folder.parent_id && !parent) return null // its parent is in the trash
    const base = parent ? dirOf(parent) : root
    if (base === null) return null
    const dir = `${base}/${uniqueIn(takenIn(base), safeName(folder.name, options.untitled))}`
    dirs.set(folder.id, dir)
    return dir
  }
  for (const folder of [...liveFolders].sort((a, b) => a.name.localeCompare(b.name, 'ro'))) {
    dirOf(folder)
  }
  const placeOf = (spaceId: string, folderId: string | null) =>
    folderId ? (dirs.get(folderId) ?? null) : (rootOf.get(spaceId) ?? null)

  const entries: ExportEntry[] = []
  for (const note of live(notes)) {
    const dir = placeOf(note.space_id, note.folder_id)
    if (dir === null) continue
    const text = noteToMarkdown(note.title, note.content, note.tags)
    const name = uniqueIn(takenIn(dir), `${safeName(note.title, options.untitled)}.md`)
    entries.push({
      kind: 'note',
      id: note.id,
      path: `${dir}/${name}`,
      text,
      size: encoder.encode(text).length,
      lastModified: new Date(note.updated_at),
    })
  }
  const noteCount = entries.length
  if (options.files) {
    for (const file of live(files)) {
      const dir = placeOf(file.space_id, file.folder_id)
      if (dir === null) continue
      const name = uniqueIn(
        takenIn(dir),
        safeName(downloadName(file.name, file.mime), options.untitled),
      )
      entries.push({
        kind: 'file',
        id: file.id,
        path: `${dir}/${name}`,
        storagePath: file.storage_path,
        size: file.size_bytes,
        lastModified: new Date(file.created_at),
      })
    }
  }
  return { entries, notes: noteCount, files: entries.length - noteCount, bytes: zipBytes(entries) }
}

const zipBytes = (entries: ExportEntry[]) =>
  Number(predictLength(entries.map((e) => ({ name: e.path, size: e.size }))))

/** The same export without the files. */
export function onlyNotes(plan: ExportPlan): ExportPlan {
  const entries = plan.entries.filter((e) => e.kind === 'note')
  return { entries, notes: entries.length, files: 0, bytes: zipBytes(entries) }
}
