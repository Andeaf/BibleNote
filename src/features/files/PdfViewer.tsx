import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
// The worker is a separate asset, precached by the service worker so PDFs open offline.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t } from '@/i18n/ro'

// Must be set in the module that renders react-pdf (see the react-pdf README).
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_WIDTH = 900
/** A4 portrait, for placeholders before a page is rendered. */
const PAGE_RATIO = 1.414

interface PdfViewerProps {
  file: Blob
}

/**
 * PDFs inside the app with pdf.js (an iframe on the iPhone shows only the first page).
 * Loaded lazily: this module and pdf.js are their own chunk. Pages render as they come near
 * the screen, so long documents stay light.
 */
export default function PdfViewer({ file }: PdfViewerProps) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [pages, setPages] = useState(0)

  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.min(MAX_WIDTH, Math.floor(entry.contentRect.width)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={box} className="w-full">
      {width > 0 && (
        <Document
          file={file}
          suspense={false}
          onLoadSuccess={(pdf) => setPages(pdf.numPages)}
          loading={<p className="py-8 text-center text-muted">{t.files.pdfLoading}</p>}
          error={<p className="py-8 text-center text-danger">{t.files.pdfError}</p>}
          className="flex flex-col items-center gap-3"
        >
          {Array.from({ length: pages }, (_, index) => (
            <LazyPage key={index} number={index + 1} width={width} />
          ))}
        </Document>
      )}
    </div>
  )
}

function LazyPage({ number, width }: { number: number; width: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(number <= 2)

  useEffect(() => {
    const element = ref.current
    if (near || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: '600px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])

  return (
    <div
      ref={ref}
      aria-label={t.files.pdfPage(number)}
      className="overflow-hidden rounded-lg border border-line bg-white shadow-sm"
      style={near ? undefined : { width, height: Math.round(width * PAGE_RATIO) }}
    >
      {near && (
        <Page
          pageNumber={number}
          width={width}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={<div style={{ width, height: Math.round(width * PAGE_RATIO) }} />}
        />
      )}
    </div>
  )
}
