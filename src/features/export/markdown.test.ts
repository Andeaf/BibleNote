import { describe, expect, it } from 'vitest'
import type { Json } from '@/lib/database.types'
import { noteToMarkdown } from './markdown'

const text = (value: string, marks: string[] = []) => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
})
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as Json

describe('notes as Markdown', () => {
  it('title, tags, headings, marks and links', () => {
    const md = noteToMarkdown(
      'Romani 8',
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Nicio osândă')] },
        p(
          text('Deci acum '),
          text('nu este', ['bold']),
          text(' nicio '),
          text('osândire', ['italic', 'underline']),
          text(' pentru cei '),
          text('în Hristos', ['highlight']),
          text('.'),
        ),
        p({
          type: 'text',
          text: 'site',
          marks: [{ type: 'link', attrs: { href: 'https://exemplu.ro/a b' } }],
        }),
      ),
      ['rugăciune', 'har'],
    )
    expect(md).toBe(
      [
        '# Romani 8',
        '',
        '#rugăciune #har',
        '',
        '## Nicio osândă',
        '',
        'Deci acum **nu este** nicio <u>*osândire*</u> pentru cei <mark>în Hristos</mark>.',
        '',
        '[site](https://exemplu.ro/a%20b)',
        '',
      ].join('\n'),
    )
  })

  it('lists, check lists and quotes, nested', () => {
    const item = (...content: unknown[]) => ({ type: 'listItem', content })
    const md = noteToMarkdown(
      'Liste',
      doc(
        {
          type: 'bulletList',
          content: [item(p(text('unu')), { type: 'bulletList', content: [item(p(text('doi')))] })],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [item(p(text('a'))), item(p(text('b')))],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p(text('făcut'))] },
            { type: 'taskItem', attrs: { checked: false }, content: [p(text('de făcut'))] },
          ],
        },
        { type: 'blockquote', content: [p(text('Citat')), p(text('Ioan 3:16'))] },
      ),
      [],
    )
    expect(md).toBe(
      [
        '# Liste',
        '',
        '- unu',
        '',
        '  - doi',
        '',
        '3. a',
        '4. b',
        '',
        '- [x] făcut',
        '- [ ] de făcut',
        '',
        '> Citat',
        '>',
        '> Ioan 3:16',
        '',
      ].join('\n'),
    )
  })

  it('text that looks like formatting stays text; hard breaks; empty notes', () => {
    const md = noteToMarkdown(
      '*Titlu*',
      doc(
        p(text('# nu e titlu')),
        p(text('1. nici listă')),
        p(text('a'), { type: 'hardBreak' }, text('b_c')),
      ),
      [],
    )
    expect(md).toBe('# \\*Titlu\\*\n\n\\# nu e titlu\n\n1\\. nici listă\n\na  \nb\\_c\n')
    expect(noteToMarkdown('Gol', {}, [])).toBe('# Gol\n')
  })
})
