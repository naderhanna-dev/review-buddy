import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setGitHubApiBase } from '@reviewradar/core'
import './index.css'
import App from './App.tsx'

// Proxy GitHub API calls through the local server to avoid CORS
// restrictions when the dashboard is accessed from a non-localhost origin.
setGitHubApiBase(`${window.location.origin}/api/github`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
