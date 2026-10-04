import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { ConfigMissing } from './components/ConfigMissing'
import { isSupabaseConfigured } from './lib/supabase'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured ? (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    ) : (
      <ConfigMissing />
    )}
  </StrictMode>,
)
