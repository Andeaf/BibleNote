import { Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell'
import { NotFoundPage } from './components/NotFoundPage'
import { UpdatePrompt } from './components/UpdatePrompt'
import { FoldersPage } from './features/folders/FoldersPage'
import { SearchPage } from './features/search/SearchPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TagsPage } from './features/tags/TagsPage'

export function App() {
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<FoldersPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <UpdatePrompt />
    </>
  )
}
