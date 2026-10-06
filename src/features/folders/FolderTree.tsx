import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useParams } from 'react-router'
import { childrenOf, pathTo } from '@/data/tree'
import { t } from '@/i18n/ro'
import type { FolderRow } from '@/lib/database.types'
import { FolderIcon } from './FolderIcon'
import { useSpaces, useSpaceFolders, type SpaceWithRole } from './hooks'

/** Desktop sidebar: every main folder with its subfolders, the current path expanded. */
export function FolderTree() {
  const spaces = useSpaces()
  if (!spaces || spaces.length === 0) return null
  const mine = spaces.filter((s) => s.role === 'owner')
  const shared = spaces.filter((s) => s.role !== 'owner')
  return (
    <nav aria-label={t.folders.title} className="flex flex-col gap-4 px-3 text-sm">
      {mine.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {mine.map((space) => (
            <SpaceNode key={space.id} space={space} />
          ))}
        </ul>
      )}
      {shared.length > 0 && (
        <div>
          <h2 className="mb-1 px-3 text-xs font-medium text-muted">{t.folders.shared}</h2>
          <ul className="flex flex-col gap-0.5">
            {shared.map((space) => (
              <SpaceNode key={space.id} space={space} />
            ))}
          </ul>
        </div>
      )}
    </nav>
  )
}

function SpaceNode({ space }: { space: SpaceWithRole }) {
  const { spaceId, folderId } = useParams()
  const folders = useSpaceFolders(space.id)
  const [toggled, setToggled] = useState<Set<string>>(() => new Set())

  const activePath = useMemo(() => {
    if (spaceId !== space.id || !folders) return new Set<string>()
    return new Set([space.id, ...pathTo(folders, folderId ?? null).map((f) => f.id)])
  }, [spaceId, space.id, folders, folderId])

  // Nodes on the active path are open unless the user closed them; others are closed unless opened.
  const isOpen = (id: string) => (activePath.has(id) ? !toggled.has(id) : toggled.has(id))
  const toggle = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderFolder = (folder: FolderRow, depth: number) => {
    const kids = childrenOf(folders ?? [], folder.id).sort((a, b) =>
      a.name.localeCompare(b.name, 'ro'),
    )
    return (
      <li key={folder.id}>
        <TreeRow
          to={`/f/${space.id}/${folder.id}`}
          depth={depth}
          hasChildren={kids.length > 0}
          open={isOpen(folder.id)}
          onToggle={() => toggle(folder.id)}
          icon={<FolderIcon emoji={folder.emoji} color={folder.color} size="sm" />}
          label={folder.name}
        />
        {kids.length > 0 && isOpen(folder.id) && (
          <ul>{kids.map((child) => renderFolder(child, depth + 1))}</ul>
        )}
      </li>
    )
  }

  const roots = childrenOf(folders ?? [], null).sort((a, b) => a.name.localeCompare(b.name, 'ro'))
  return (
    <li>
      <TreeRow
        to={`/f/${space.id}`}
        depth={0}
        end
        hasChildren={roots.length > 0}
        open={isOpen(space.id)}
        onToggle={() => toggle(space.id)}
        icon={<FolderIcon emoji={space.emoji} color={space.color} size="sm" />}
        label={space.name}
      />
      {roots.length > 0 && isOpen(space.id) && <ul>{roots.map((f) => renderFolder(f, 1))}</ul>}
    </li>
  )
}

interface TreeRowProps {
  to: string
  depth: number
  end?: boolean
  hasChildren: boolean
  open: boolean
  onToggle: () => void
  icon: React.ReactNode
  label: string
}

function TreeRow({ to, depth, end, hasChildren, open, onToggle, icon, label }: TreeRowProps) {
  return (
    <div className="flex items-center" style={{ paddingLeft: `${depth * 0.75}rem` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={hasChildren ? open : undefined}
        aria-label={label}
        tabIndex={hasChildren ? 0 : -1}
        className={`flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:text-ink ${
          hasChildren ? '' : 'invisible'
        }`}
      >
        <ChevronRight
          className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          `flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 ${
            isActive ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-canvas'
          }`
        }
      >
        {icon}
        <span className="truncate">{label}</span>
      </NavLink>
    </div>
  )
}
