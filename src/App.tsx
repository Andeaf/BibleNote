import { Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './components/AppShell'
import { NotFoundPage } from './components/NotFoundPage'
import { UpdatePrompt } from './components/UpdatePrompt'
import { LoginPage } from './features/auth/LoginPage'
import { FolderPage } from './features/folders/FolderPage'
import { FoldersPage } from './features/folders/FoldersPage'
import { SearchPage } from './features/search/SearchPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TagsPage } from './features/tags/TagsPage'

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<FoldersPage />} />
            <Route path="f/:spaceId" element={<FolderPage />} />
            <Route path="f/:spaceId/:folderId" element={<FolderPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      <UpdatePrompt />
    </AuthProvider>
  )
}
