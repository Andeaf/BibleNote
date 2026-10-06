import type { BibleNoteDb } from '@/lib/db'
import type { OutboxEntry, OutboxOp, WritableTable } from './types'

export interface EnqueueInput {
  table: WritableTable
  row_id: string
  space_id: string
  op: OutboxOp
  payload: Record<string, unknown>
}

export const outboxKey = (table: string, rowId: string): string => `${table}:${rowId}`

/**
 * Adds a change to the outbox, coalescing with an existing entry for the same row:
 * - same op (update + update): the payloads merge, the first entry keeps its seq;
 * - update after a not-yet-sent insert: merged into the insert, the row reaches the server
 *   in its final state in one request;
 * - an entry that is in flight is never touched: a new entry is queued behind it.
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
  const target = existing.find(
    (entry) =>
      entry.status !== 'inflight' &&
      (entry.op === input.op || (input.op === 'update' && entry.op === 'insert')),
  )
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
  await db.outbox.add(entry)
}
