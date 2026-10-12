import { t } from '@/i18n/ro'
import type { BibleRef } from './parser'
import type { VersesState } from './text'

/** The verses of a reference as reading text, with their numbers; or loading / failed. */
export function Passage({ reference, state }: { reference: BibleRef; state: VersesState }) {
  if (state.status === 'loading') {
    return (
      <p role="status" className="text-sm text-muted">
        {t.common.loading}
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        {t.bible.loadFailed}
      </p>
    )
  }
  return (
    <p className="font-serif text-[1.0625rem] leading-relaxed text-ink">
      {state.verses.map((verse) => (
        <span key={`${verse.chapter}:${verse.verse}`}>
          <sup className="mr-1 font-sans text-xs font-semibold text-accent">
            {verse.chapter !== reference.chapter && verse.verse === 1
              ? `${verse.chapter}:${verse.verse}`
              : verse.verse}
          </sup>
          {verse.text}{' '}
        </span>
      ))}
    </p>
  )
}
