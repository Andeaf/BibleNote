import { describe, expect, it } from 'vitest'
import type { NoteRow } from '@/lib/database.types'
import { queryWords, searchNotes, snippetOf } from './searchIndex'

const note = (id: string, title: string, text: string, tags: string[] = [], at = 1): NoteRow => ({
  id,
  space_id: 's',
  folder_id: null,
  title,
  content: {},
  content_text: text,
  tags,
  pinned: false,
  version: 1,
  created_by: null,
  updated_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: new Date(Date.UTC(2026, 0, at)).toISOString(),
  deleted_at: null,
  purged_at: null,
})

const notes = [
  note('1', 'Rugăciunea domnească', 'Tatăl nostru care ești în ceruri', ['rugăciune'], 1),
  note('2', 'Profeții', 'Isaia vorbește despre rugăciune și post', ['profeții'], 2),
  note('3', 'Cântări', 'Psalmul 23: Domnul este păstorul meu', ['psalmi'], 3),
  note('4', 'Notițe vechi', 'Ştiinţa şi credinţa (diacritice cu sedilă)', [], 4),
]

describe('search', () => {
  it('ignores case and diacritics, in the query and in the notes', () => {
    expect(searchNotes(notes, 'RUGACIUNE').map((h) => h.note.id)).toEqual(['1', '2'])
    expect(searchNotes(notes, 'păstorul').map((h) => h.note.id)).toEqual(['3'])
    expect(searchNotes(notes, 'stiinta credinta').map((h) => h.note.id)).toEqual(['4'])
    expect(searchNotes(notes, 'știința').map((h) => h.note.id)).toEqual(['4'])
  })

  it('needs every word, ranks title over tags over text, then newer first', () => {
    expect(searchNotes(notes, 'domn').map((h) => h.note.id)).toEqual(['1', '3'])
    expect(searchNotes(notes, 'isaia post').map((h) => h.note.id)).toEqual(['2'])
    expect(searchNotes(notes, 'isaia psalmul')).toEqual([])
    expect(searchNotes(notes, '#psalmi').map((h) => h.note.id)).toEqual(['3'])
    expect(searchNotes(notes, '   ')).toEqual([])
  })

  it('splits the query into normalized words', () => {
    expect(queryWords('  #Rugăciune  Și ')).toEqual(['rugaciune', 'si'])
  })

  it('cuts a snippet around the match in the original text', () => {
    const text = `${'început '.repeat(20)}vorbește despre rugăciune și post${' final'.repeat(20)}`
    const snippet = snippetOf(text, 'rugaciune')
    expect(snippet?.match).toBe('rugăciune')
    expect(snippet?.before.startsWith('…')).toBe(true)
    expect(snippet?.after.endsWith('…')).toBe(true)
    expect(snippet?.before.endsWith('despre ')).toBe(true)
    expect(snippetOf('scurt', 'lipsă')).toBeNull()
    expect(snippetOf('Ţara mea', 'tara')).toEqual({ before: '', match: 'Ţara', after: ' mea' })
  })
})
