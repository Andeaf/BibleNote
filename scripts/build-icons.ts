/**
 * Generates the PWA icons from public/icon.svg.
 * Run with: npm run build:icons
 *
 * - pwa-192x192.png, pwa-512x512.png: the icon as drawn (rounded square).
 * - pwa-maskable-512x512.png, apple-touch-icon-180x180.png: full-bleed background with the
 *   artwork inside the safe zone (80%), because the platform applies its own mask.
 */
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

const BACKGROUND = '#2f6f6d'
const svg = await readFile('public/icon.svg')

for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(`public/pwa-${size}x${size}.png`)
}

const fullBleed: Array<[number, string]> = [
  [512, 'public/pwa-maskable-512x512.png'],
  [180, 'public/apple-touch-icon-180x180.png'],
]
for (const [size, file] of fullBleed) {
  const inner = Math.round(size * 0.8)
  const artwork = await sharp(svg).resize(inner, inner).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: artwork, gravity: 'centre' }])
    .png()
    .toFile(file)
}

console.log('Icons written to public/')
