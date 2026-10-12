import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { ConfigMissing } from './components/ConfigMissing'
import { listenForInstall } from './lib/install'
import { isSupabaseConfigured } from './lib/supabase'
import './styles/index.css'

// Before anything renders: the browser offers installing once, early.
listenForInstall()

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
