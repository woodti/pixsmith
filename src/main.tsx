import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { desktop, openLinksExternally } from './lib/desktop'
import './styles.css'

if (desktop) openLinksExternally()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
