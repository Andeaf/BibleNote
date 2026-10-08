import { FolderOpen, Search, Settings, Tag } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { FolderTree } from '@/features/folders/FolderTree'
import { t } from '@/i18n/ro'
import { SyncIndicator } from './SyncIndicator'
import { Toaster } from './Toaster'

const navItems = [
  { to: '/', label: t.nav.folders, icon: FolderOpen, end: true },
  { to: '/search', label: t.nav.search, icon: Search, end: false },
  { to: '/tags', label: t.nav.tags, icon: Tag, end: false },
  { to: '/settings', label: t.nav.settings, icon: Settings, end: false },
]

/**
 * Application frame: sidebar with the folder tree on desktop (lg and up), bottom navigation
 * on phones. Pages render in the <Outlet />.
 */
export function AppShell() {
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-72 lg:flex-col">
        <div className="px-5 py-4">
          <span className="text-lg font-semibold tracking-tight">{t.app.name}</span>
        </div>
        <nav aria-label={t.nav.main} className="flex flex-col gap-1 px-3">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-accent-soft text-accent'
                    : 'text-muted hover:bg-canvas hover:text-ink'
                }`
              }
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-line pt-3">
          <FolderTree />
        </div>
        <div className="border-t border-line">
          <SyncIndicator variant="bar" />
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-24">
        <Outlet />
      </main>

      <Toaster />

      <nav
        aria-label={t.nav.main}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="grid grid-cols-4">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium ${
                    isActive ? 'text-accent' : 'text-muted'
                  }`
                }
              >
                <Icon className="size-6" aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
