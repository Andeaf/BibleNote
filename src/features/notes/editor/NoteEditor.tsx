import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { discardIfEmpty, saveNoteContent } from '@/data/notes'
import { useIsDesktop } from '@/features/folders/hooks'
import { TagChip } from '@/features/tags/TagChip'
import { TagEditor } from '@/features/tags/TagEditor'
import { t } from '@/i18n/ro'
import type { Json, NoteRow } from '@/lib/database.types'
import { tagPath } from '@/lib/paths'
import { conflictKey, contentOf, sameContent, type NoteContent } from '@/sync/conflicts'
import { useSyncRuntime } from '@/sync/SyncContext'
import { ModifiedBy } from '../ModifiedBy'
import { EditorToolbar } from './EditorToolbar'
import { docOf, noteExtensions } from './extensions'
import { LinkDialog } from './LinkDialog'
import { useKeyboardInset } from './useKeyboardInset'

interface NoteEditorProps {
  /** The live row (re-rendered on every change in Dexie). Mount one editor per note id. */
  note: NoteRow
  readOnly: boolean
  /** Every tag in use, for autocomplete. */
  knownTags: string[]
  /** The text now lives in another note (a conflict copy): show that one instead. */
  onSwitch: (noteId: string) => void
  /** True from the first keystroke until the change is in Dexie and the outbox. */
  onDirtyChange: (dirty: boolean) => void
}

const SAVE_DELAY_MS = 1000
/** How many of its own recent versions the editor remembers, to tell its echoes from others. */
const OWN_VERSIONS = 5

/**
 * Title, tags and the Tiptap editor of one note, with autosave (1 s after the last change, and
 * when leaving). Each save says which content it was based on; the data layer writes it only
 * if the note still holds that content, otherwise the text goes to a conflict copy and the
 * editor follows it (docs/PLAN.md §4.5). A change from elsewhere while nothing is being typed
 * is loaded into the editor.
 */
export function NoteEditor({
  note,
  readOnly,
  knownTags,
  onSwitch,
  onDirtyChange,
}: NoteEditorProps) {
  const runtime = useSyncRuntime()
  const { db, engine, userId } = runtime
  const isDesktop = useIsDesktop()
  const [title, setTitle] = useState(note.title)
  const [tags, setTags] = useState(note.tags)
  const [focused, setFocused] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const titleEl = useRef<HTMLTextAreaElement>(null)

  /** The note the text is written to (changes when it moves to a conflict copy). */
  const target = useRef(note.id)
  /** The content the editor's document descends from: the base of the next save. */
  const expected = useRef<NoteContent>(contentOf(note))
  /** Contents this editor loaded or wrote lately: when the row shows one of them, it is ours. */
  const own = useRef<NoteContent[]>([contentOf(note)])
  const titleRef = useRef(note.title)
  const tagsRef = useRef(note.tags)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const editorRef = useRef<Editor | null>(null)
  const callbacks = useRef({ onSwitch, onDirtyChange, readOnly })
  useEffect(() => {
    callbacks.current = { onSwitch, onDirtyChange, readOnly }
  })

  const remember = (content: NoteContent) => {
    own.current = [content, ...own.current].slice(0, OWN_VERSIONS)
  }

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const editor = editorRef.current
    if (!dirty.current || !editor || editor.isDestroyed) return chain.current
    dirty.current = false
    const next: NoteContent = {
      title: titleRef.current,
      content: editor.getJSON() as Json,
      // Nested blocks (list > item > paragraph) would leave runs of blank lines.
      content_text: editor.getText({ blockSeparator: '\n' }).replace(/\n{2,}/g, '\n'),
      tags: tagsRef.current,
    }
    const base = expected.current
    expected.current = next
    remember(next)
    chain.current = chain.current.then(async () => {
      try {
        const result = await saveNoteContent(db, userId, target.current, base, next)
        engine.requestPush()
        if (result.status === 'moved' || result.status === 'copied') {
          if (result.status === 'copied') {
            runtime.notify({
              kind: 'conflict',
              noteId: target.current,
              copyId: result.noteId,
              name: '',
            })
          }
          target.current = result.noteId
          callbacks.current.onSwitch(result.noteId)
        }
      } catch {
        // Not written (e.g. storage full): keep the change and try again with the next save.
        if (expected.current === next) {
          expected.current = base
          dirty.current = true
        }
      }
      if (!dirty.current) callbacks.current.onDirtyChange(false)
    })
    return chain.current
  }, [db, engine, runtime, userId])

  const markDirty = useCallback(() => {
    if (callbacks.current.readOnly) return
    dirty.current = true
    callbacks.current.onDirtyChange(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }, [flush])

  const extensions = useMemo(() => noteExtensions(t.notes.bodyPlaceholder), [])
  const editor = useEditor({
    extensions,
    content: docOf(note.content),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'bn-editor',
        'aria-label': t.notes.body,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: () => markDirty(),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  })
  useEffect(() => {
    editorRef.current = editor
  }, [editor])
  useEffect(() => {
    // Without emitting an update: that would count as an edit.
    if (editor.isEditable !== !readOnly) editor.setEditable(!readOnly, false)
  }, [editor, readOnly])

  // An editor opened now starts from what the note holds; an older conflict marker is stale.
  useEffect(() => {
    void db.meta.delete(conflictKey(note.id))
    // Only on mount: later markers are for this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db])

  // A change that did not come from this editor: a pull, or a conflict resolved by the engine.
  useEffect(() => {
    if (note.id !== target.current || dirty.current) return
    if (own.current.some((content) => sameContent(content, note))) return
    let cancelled = false
    void (async () => {
      const marker = await db.meta.get(conflictKey(note.id))
      if (cancelled || dirty.current) return
      if (marker && !readOnly) {
        // The engine saved this editor's text as a copy: continue there.
        await db.meta.delete(conflictKey(note.id))
        target.current = marker.value
        callbacks.current.onSwitch(marker.value)
        return
      }
      const loaded = contentOf(note)
      expected.current = loaded
      remember(loaded)
      editor.commands.setContent(docOf(note.content), { emitUpdate: false })
      titleRef.current = note.title
      tagsRef.current = note.tags
      setTitle(note.title)
      setTags(note.tags)
    })()
    return () => {
      cancelled = true
    }
  }, [note, db, editor, readOnly])

  // Save when leaving the note, the page or the app (and drop a new note left empty).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => void flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      void flush().then(() => discardIfEmpty(db, target.current))
    }
  }, [db, flush])

  // The title grows with its text.
  useLayoutEffect(() => {
    const el = titleEl.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])

  const phoneToolbar = !readOnly && !isDesktop && focused
  const inset = useKeyboardInset(phoneToolbar)
  // Floating notices and the caret stay above the phone toolbar while it shows.
  useEffect(() => {
    if (!phoneToolbar) return
    const root = document.documentElement
    const above = inset > 0 ? `${inset + 60}px` : 'calc(7.25rem + env(safe-area-inset-bottom))'
    root.style.setProperty('--bn-notice-lift', above)
    root.style.scrollPaddingBottom = above
    return () => {
      root.style.removeProperty('--bn-notice-lift')
      root.style.scrollPaddingBottom = ''
    }
  }, [phoneToolbar, inset])

  function openLink() {
    setLink((editor.getAttributes('link').href as string | undefined) ?? '')
  }

  function applyLink(href: string) {
    const chain = editor.chain().focus()
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
    } else {
      chain.extendMarkRange('link').setLink({ href })
    }
    chain.run()
    setLink(null)
  }

  return (
    <div className="pb-8">
      {!readOnly && isDesktop && (
        <div className="sticky top-0 z-10 -mx-2 mb-2 border-b border-line bg-canvas/95 py-1 backdrop-blur">
          <EditorToolbar editor={editor} onLink={openLink} />
        </div>
      )}

      <textarea
        ref={titleEl}
        value={title}
        rows={1}
        readOnly={readOnly}
        onChange={(event) => {
          const value = event.target.value.replace(/\n/g, ' ')
          titleRef.current = value
          setTitle(value)
          markDirty()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            editor.commands.focus('start')
          }
        }}
        placeholder={t.notes.titlePlaceholder}
        aria-label={t.notes.title}
        enterKeyHint="next"
        className="mt-4 block w-full resize-none overflow-hidden bg-transparent font-serif text-2xl leading-tight font-semibold text-ink outline-none placeholder:text-muted/70 lg:text-3xl"
      />

      <div className="mt-2">
        {readOnly ? (
          tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagChip key={tag} tag={tag} to={tagPath(tag)} />
              ))}
            </div>
          )
        ) : (
          <TagEditor
            tags={tags}
            known={knownTags}
            onChange={(next) => {
              tagsRef.current = next
              setTags(next)
              markDirty()
            }}
          />
        )}
      </div>

      <ModifiedBy note={note} />

      <EditorContent editor={editor} className="mt-4" />

      {phoneToolbar && (
        <div
          className="fixed inset-x-0 z-30 border-t border-line bg-surface py-1 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
          style={{ bottom: inset > 0 ? inset : 'calc(3.5rem + env(safe-area-inset-bottom))' }}
        >
          <EditorToolbar editor={editor} onLink={openLink} />
        </div>
      )}

      {link !== null && (
        <LinkDialog
          open
          href={link}
          onClose={() => setLink(null)}
          onApply={applyLink}
          onRemove={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            setLink(null)
          }}
        />
      )}
    </div>
  )
}
