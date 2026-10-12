/**
 * Builds the Bible text from the USFX source (docs/PLAN.md §5.9):
 *   data/ron-rccv.usfx.xml
 *   → public/bible/rccv/<ID>.json        { id, name, chapters: [[verse 1, verse 2, …], …] }
 *   → public/bible/rccv/index.json       books in order, names, abbreviations, verse counts
 *   → src/features/bible/verseCounts.json  verse counts per chapter, for the reference parser
 * Normalises ş/ţ (cedilla) to ș/ț (comma below), drops every tag (<wj>, <p>, …), checks the
 * book names against src/features/bible/books.ts and the totals: 66 books, 1189 chapters,
 * 31102 verses.
 * Run with: npm run build:bible
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BOOKS, displayName } from '../src/features/bible/books.ts'

const SOURCE = path.join('data', 'ron-rccv.usfx.xml')
const OUT_DIR = path.join('public', 'bible', 'rccv')
const COUNTS = path.join('src', 'features', 'bible', 'verseCounts.json')

const CEDILLA: Record<string, string> = { ş: 'ș', Ş: 'Ș', ţ: 'ț', Ţ: 'Ț' }
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

/** Text without tags, entities or cedillas, on one line. */
function clean(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[şŞţŢ]/g, (char) => CEDILLA[char] ?? char)
    .replace(/\s+/g, ' ')
    .trim()
}

function fail(message: string): never {
  throw new Error(`build-bible: ${message}`)
}

const xml = await readFile(SOURCE, 'utf8')
const books = [...xml.matchAll(/<book id="([A-Z0-9]+)">([\s\S]*?)<\/book>/g)]
if (books.length !== BOOKS.length) fail(`${books.length} books in the source`)

await mkdir(OUT_DIR, { recursive: true })
const counts: Record<string, number[]> = {}
let chapterTotal = 0
let verseTotal = 0

for (const [index, [, id, body]] of books.entries()) {
  const info = BOOKS[index]
  if (!info || info.id !== id) fail(`book ${index + 1} is ${id}, books.ts has ${info?.id}`)
  const title = clean(/<h>([\s\S]*?)<\/h>/.exec(body ?? '')?.[1] ?? '')
  if (title !== displayName(info)) fail(`${id} is "${title}" in the source`)

  // Everything before the first chapter is the book's header (id, title paragraph).
  const parts = (body ?? '').split(/<c id="(\d+)"\s*\/>/)
  const chapters: string[][] = []
  for (let i = 1; i < parts.length; i += 2) {
    const number = Number(parts[i])
    if (number !== chapters.length + 1) fail(`${id} chapter ${number} out of order`)
    const pieces = (parts[i + 1] ?? '').split(/<v id="(\d+)"\s*\/>/)
    if (clean(pieces[0] ?? '')) fail(`${id} ${number}: text before the first verse`)
    const verses: string[] = []
    for (let j = 1; j < pieces.length; j += 2) {
      if (Number(pieces[j]) !== verses.length + 1) fail(`${id} ${number}:${pieces[j]} out of order`)
      const text = clean(pieces[j + 1] ?? '')
      if (!text) fail(`${id} ${number}:${pieces[j]} is empty`)
      verses.push(text)
    }
    chapters.push(verses)
  }

  counts[id] = chapters.map((verses) => verses.length)
  chapterTotal += chapters.length
  verseTotal += chapters.reduce((sum, verses) => sum + verses.length, 0)
  await writeFile(
    path.join(OUT_DIR, `${id}.json`),
    JSON.stringify({ id, name: displayName(info), chapters }),
  )
}

if (chapterTotal !== 1189 || verseTotal !== 31102) {
  fail(`${chapterTotal} chapters and ${verseTotal} verses, expected 1189 and 31102`)
}

await writeFile(
  path.join(OUT_DIR, 'index.json'),
  JSON.stringify({
    title: 'Romanian Corrected Cornilescu Version',
    license: 'Public domain',
    source: 'https://github.com/seven1m/open-bibles (ron-rccv.usfx.xml)',
    books: BOOKS.map((book) => ({
      id: book.id,
      name: displayName(book),
      names: book.names,
      abbreviations: book.abbreviations,
      chapterLinks: book.chapterLinks,
      verses: counts[book.id],
    })),
  }),
)
await writeFile(COUNTS, `${JSON.stringify(counts)}\n`)

console.log(`${books.length} books, ${chapterTotal} chapters, ${verseTotal} verses → ${OUT_DIR}`)
