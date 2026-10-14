import type { BibleNoteDb } from '@/lib/db'
import type { OutboxEntry, OutboxOp, WritableTable } from './types'

export interface EnqueueInput {
  table: WritableTable
  row_id: string
  space_id: string
  op: OutboxOp
  payload: Record<string, unknown>
  /** save_note only: see OutboxEntry.base_version. */
  base_version?: number | null
}

export const outboxKey = (table: string, rowId: string): string => `${table}:${rowId}`

/**
 * True when the entry creates its row on the server: an insert, a file upload, or a save_note for
 * a note the server does not have yet. Such an entry follows every insert rule: rows pointing at
 * it wait, it waits for its space and parent folder, it moves to the root when the folder is
 * gone, and a resend after a lost answer continues as an update.
 */
export const createsRow = (entry: Pick<OutboxEntry, 'op' | 'base_version'>): boolean =>
  entry.op === 'insert' ||
  entry.op === 'upload' ||
  (entry.op === 'save_note' && entry.base_version == null)

/**
 * Rows a not-yet-confirmed create (insert, upload, save_note of a new note) will make: anything
 * that points at them must wait. Failed creates count too: a child of a parent that failed waits
 * until the parent is retried or discarded, instead of failing (or moving to the root) alone.
 */
export function unsentCreateKeys(entries: readonly OutboxEntry[]): Set<string> {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (createsRow(entry)) keys.add(outboxKey(entry.table, entry.row_id))
  }
  return keys
}

/**
 * An input can ride along with an existing entry: same op, or an update after a direct insert
 * (an insert or a file upload: the row is inserted with the final values).
 */
const canMerge = (entry: OutboxEntry, input: EnqueueInput): boolean =>
  entry.op === input.op ||
  (input.op === 'update' && (entry.op === 'insert' || entry.op === 'upload'))

/**
 * Adds a change to the outbox, coalescing with an existing entry for the same row:
 * - same op (update + update, save_note + save_note): the payloads merge, the entry keeps its
 *   seq (so a folder created before a note stays ahead of it) and, for save_note, the base
 *   version of the first edit;
 * - update after a not-yet-sent insert or upload: merged into it, the row reaches the server in
 *   its final state in one request. Note metadata never merges into a note create: update_note_meta
 *   is always a separate entry behind the save_note;
 * - the search starts at the newest entry of the row and stops at one it cannot merge with that
 *   writes a column of this change: merging further back would let that later entry overwrite
 *   the newer value on the server. An entry in flight is never touched.
 * A failed entry that receives a new edit becomes pending again (the edit is the retry).
 * Call inside a transaction that also writes the row, so both land together.
 */
export async function enqueue(
  db: BibleNoteDb,
  input: EnqueueInput,
  now = Date.now(),
): Promise<void> {
  const existing = await db.outbox
    .where('[table+row_id]')
    .equals([input.table, input.row_id])
    .sortBy('seq')
  const columns = Object.keys(input.payload)
  let target: OutboxEntry | undefined
  for (const entry of existing.reverse()) {
    if (entry.status !== 'inflight' && canMerge(entry, input)) {
      target = entry
      break
    }
    if (Object.keys(entry.payload).some((column) => columns.includes(column))) break
  }
  if (target?.seq !== undefined) {
    await db.outbox.update(target.seq, {
      payload: { ...target.payload, ...input.payload },
      status: 'pending',
      attempts: 0,
      next_attempt_at: 0,
      last_error: null,
    })
    return
  }
  const entry: OutboxEntry = {
    table: input.table,
    row_id: input.row_id,
    space_id: input.space_id,
    op: input.op,
    payload: { ...input.payload },
    status: 'pending',
    attempts: 0,
    created_at: now,
    next_attempt_at: 0,
    last_error: null,
  }
  if (input.op === 'save_note') entry.base_version = input.base_version ?? null
  await db.outbox.add(entry)
}
