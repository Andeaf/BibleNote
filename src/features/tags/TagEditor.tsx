import { useId, useState } from 'react'
import { t } from '@/i18n/ro'
import { addTag, suggestTags } from '@/lib/tags'
import { TagChip } from './TagChip'

interface TagEditorProps {
  tags: string[]
  /** Every tag already used on this device, for autocomplete. */
  known: string[]
  onChange: (tags: string[]) => void
}

/**
 * The chips under the note title. Enter, comma or leaving the field adds what was typed;
 * Backspace in the empty field removes the last chip. Suggestions come from the existing tags,
 * and an existing tag keeps its spelling.
 */
export function TagEditor({ tags, known, onChange }: TagEditorProps) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const hintId = useId()
  const suggestions = focused && draft.trim() ? suggestTags(known, draft, tags) : []

  function commit(value = draft) {
    const next = addTag(tags, value, known)
    setDraft('')
    if (next.length !== tags.length) onChange(next)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <TagChip
            key={tag}
            tag={tag}
            onRemove={() => onChange(tags.filter((other) => other !== tag))}
          />
        ))}
        <input
          value={draft}
          onChange={(event) => {
            const value = event.target.value
            if (/[,\n]/.test(value)) commit(value.replace(/[,\n]/g, ''))
            else setDraft(value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1))
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (draft.trim()) commit()
          }}
          placeholder={tags.length === 0 ? t.notes.addTag : '#'}
          aria-label={t.notes.addTag}
          aria-describedby={hintId}
          enterKeyHint="done"
          autoCapitalize="none"
          className="min-h-11 min-w-32 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-muted"
        />
        <span id={hintId} className="sr-only">
          {t.notes.addTagHint}
        </span>
      </div>
      {suggestions.length > 0 && (
        <ul aria-label={t.notes.tagSuggestions} className="mt-1 flex flex-wrap gap-1.5">
          {suggestions.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                // Keeps the focus in the field: its blur would add the half-typed text.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(tag)}
                className="min-h-11 rounded-full border border-line px-3 text-sm text-muted hover:text-ink"
              >
                #{tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
