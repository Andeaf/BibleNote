import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import viteConfig from '../../../vite.config.ts?raw'
import viewerSource from './PdfViewer.tsx?raw'

// pdf.js's modern build calls built-ins only the newest browsers have: on an older Chrome for
// Android every PDF page stayed blank. The app uses the legacy build (main thread and worker),
// which brings its own polyfills.

const NEWEST_BUILT_INS: [object, string][] = [
  [Map.prototype, 'getOrInsertComputed'],
  [Map.prototype, 'getOrInsert'],
  [WeakMap.prototype, 'getOrInsertComputed'],
  [WeakMap.prototype, 'getOrInsert'],
  [Math, 'sumPrecise'],
  [Uint8Array.prototype, 'toHex'],
  [Uint8Array, 'fromBase64'],
]

/** A one-page PDF with a line of text, xref offsets included. */
function samplePdf(): Uint8Array {
  const content = 'BT /F1 18 Tf 20 100 Td (Ioan 3:16) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

describe('pdf.js build', () => {
  it('the app takes pdf.js from the legacy build, on the main thread and in the worker', () => {
    expect(viteConfig).toMatch(
      /find: \/\^pdfjs-dist\$\/, replacement: 'pdfjs-dist\/legacy\/build\/pdf\.mjs'/,
    )
    expect(viteConfig).toMatch(/replacement: 'pdfjs-dist\/legacy\/web\/pdf_viewer\.mjs'/)
    expect(viewerSource).toContain("from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'")
  })

  describe('without the newest built-ins (an older phone)', () => {
    const saved: [object, string, PropertyDescriptor][] = []

    beforeAll(() => {
      for (const [owner, name] of NEWEST_BUILT_INS) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, name)
        if (!descriptor) continue
        saved.push([owner, name, descriptor])
        Reflect.deleteProperty(owner, name)
      }
    })

    afterAll(() => {
      for (const [owner, name, descriptor] of saved) Object.defineProperty(owner, name, descriptor)
    })

    it('the legacy build opens a PDF and prepares its page', async () => {
      // The worker runs on this thread (pdf.js's fake worker), so it sees the same globals.
      const workerModule = 'pdfjs-dist/legacy/build/pdf.worker.mjs'
      ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import(workerModule)
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

      const task = pdfjs.getDocument({ data: samplePdf(), verbosity: 0 })
      try {
        const pdf = await task.promise
        expect(pdf.numPages).toBe(1)
        // What react-pdf's canvas asks for first; the modern build failed right here.
        await pdf.getOptionalContentConfig()
        const page = await pdf.getPage(1)
        const operators = await page.getOperatorList()
        expect(operators.fnArray.length).toBeGreaterThan(0)
      } finally {
        await task.destroy()
      }
    }, 30_000)
  })
})
