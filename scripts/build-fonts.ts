/**
 * Copies the self-hosted font files (OFL) from the @fontsource-variable packages into
 * public/fonts. Only latin + latin-ext subsets are shipped: they cover Romanian, including
 * ș and ț with comma below. The @font-face rules live in src/styles/index.css.
 * Run with: npm run build:fonts
 */
import { access, copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const FILES = [
  '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2',
  '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2',
  '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-wght-normal.woff2',
  '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2',
  '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-wght-italic.woff2',
]

const outDir = path.join('public', 'fonts')
await mkdir(outDir, { recursive: true })

for (const file of FILES) {
  const source = path.join('node_modules', file)
  await access(source)
  await copyFile(source, path.join(outDir, path.basename(file)))
}

console.log(`${FILES.length} font files written to ${outDir}`)
