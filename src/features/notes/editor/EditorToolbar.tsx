import { useEditorState, type ChainedCommands, type Editor } from '@tiptap/react'
import {
  Bold,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { t } from '@/i18n/ro'
import { HIGHLIGHT_COLORS, type HighlightColor } from './extensions'

interface EditorToolbarProps {
  editor: Editor
  onLink: () => void
}

interface ToolButtonProps {
  label: string
  icon: LucideIcon
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function ToolButton({ label, icon: Icon, active, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      // The editor keeps the focus (and the phone keeps its keyboard open).
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={`flex size-11 shrink-0 items-center justify-center rounded-lg disabled:opacity-40 ${
        active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-canvas'
      }`}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  )
}

const Divider = () => <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-line" />

/** The minimal toolbar of the spec. One row; it scrolls sideways on narrow phones. */
export function EditorToolbar({ editor, onLink }: EditorToolbarProps) {
  const [colors, setColors] = useState(false)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      highlight: e.isActive('highlight'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
    }),
  })
  const run = (command: (chain: ChainedCommands) => ChainedCommands) => () =>
    command(editor.chain().focus()).run()
  const highlight = (color: HighlightColor | null) => {
    if (color) run((c) => c.setHighlight({ color }))()
    else run((c) => c.unsetHighlight())()
    setColors(false)
  }

  return (
    <div
      role="toolbar"
      aria-label={t.editor.toolbar}
      className="flex items-center gap-0.5 overflow-x-auto overscroll-x-contain px-1"
    >
      <ToolButton
        label={t.editor.undo}
        icon={Undo2}
        disabled={!state.canUndo}
        onClick={run((c) => c.undo())}
      />
      <ToolButton
        label={t.editor.redo}
        icon={Redo2}
        disabled={!state.canRedo}
        onClick={run((c) => c.redo())}
      />
      <Divider />
      <ToolButton
        label={t.editor.heading(1)}
        icon={Heading1}
        active={state.h1}
        onClick={run((c) => c.toggleHeading({ level: 1 }))}
      />
      <ToolButton
        label={t.editor.heading(2)}
        icon={Heading2}
        active={state.h2}
        onClick={run((c) => c.toggleHeading({ level: 2 }))}
      />
      <ToolButton
        label={t.editor.heading(3)}
        icon={Heading3}
        active={state.h3}
        onClick={run((c) => c.toggleHeading({ level: 3 }))}
      />
      <Divider />
      <ToolButton
        label={t.editor.bold}
        icon={Bold}
        active={state.bold}
        onClick={run((c) => c.toggleBold())}
      />
      <ToolButton
        label={t.editor.italic}
        icon={Italic}
        active={state.italic}
        onClick={run((c) => c.toggleItalic())}
      />
      <ToolButton
        label={t.editor.underline}
        icon={Underline}
        active={state.underline}
        onClick={run((c) => c.toggleUnderline())}
      />
      <ToolButton
        label={t.editor.highlight}
        icon={Highlighter}
        active={state.highlight || colors}
        onClick={() => setColors((open) => !open)}
      />
      {colors && (
        <span role="group" aria-label={t.editor.highlight} className="flex shrink-0 items-center">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => highlight(color)}
              aria-label={t.editor.highlightIn(t.editor.colors[color])}
              title={t.editor.highlightIn(t.editor.colors[color])}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-canvas"
            >
              <span
                aria-hidden="true"
                data-color={color}
                className="bn-swatch size-6 rounded-full border border-line"
              />
            </button>
          ))}
          <ToolButton label={t.editor.noHighlight} icon={Eraser} onClick={() => highlight(null)} />
        </span>
      )}
      <Divider />
      <ToolButton
        label={t.editor.bulletList}
        icon={List}
        active={state.bullet}
        onClick={run((c) => c.toggleBulletList())}
      />
      <ToolButton
        label={t.editor.orderedList}
        icon={ListOrdered}
        active={state.ordered}
        onClick={run((c) => c.toggleOrderedList())}
      />
      <ToolButton
        label={t.editor.taskList}
        icon={ListChecks}
        active={state.task}
        onClick={run((c) => c.toggleTaskList())}
      />
      <ToolButton
        label={t.editor.quote}
        icon={Quote}
        active={state.quote}
        onClick={run((c) => c.toggleBlockquote())}
      />
      <ToolButton label={t.editor.link} icon={Link} active={state.link} onClick={onLink} />
    </div>
  )
}
