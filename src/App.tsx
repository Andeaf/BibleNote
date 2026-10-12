import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './components/AppShell'
import { NotFoundPage } from './components/NotFoundPage'
import { UpdatePrompt } from './components/UpdatePrompt'
import { LoginPage } from './features/auth/LoginPage'
import { FilePage } from './features/files/FilePage'
import { FolderPage } from './features/folders/FolderPage'
import { FoldersPage } from './features/folders/FoldersPage'
import { SearchPage } from './features/search/SearchPage'
import { JoinPage } from './features/share/JoinPage'
import { SharePage } from './features/share/SharePage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TagNotesPage, TagsPage } from './features/tags/TagsPage'

// The editor (Tiptap, ProseMirror) is a separate chunk, loaded when a note is opened and
// precached by the service worker, so it works offline too.
const NotePage = lazy(() => import('./features/notes/NotePage'))

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        {/* A share link: works signed out (guest) and signed in, before the app shell. */}
        <Route path="s/:token" element={<JoinPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<FoldersPage />} />
            <Route path="f/:spaceId" element={<FolderPage />} />
            <Route path="f/:spaceId/share" element={<SharePage />} />
            <Route path="f/:spaceId/:folderId" element={<FolderPage />} />
            <Route
              path="n/:noteId"
              element={
                <Suspense fallback={null}>
                  <NotePage />
                </Suspense>
              }
            />
            <Route path="file/:fileId" element={<FilePage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="tags/:tag" element={<TagNotesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      <UpdatePrompt />
    </AuthProvider>
  )
}
