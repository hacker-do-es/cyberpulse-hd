import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { installUnauthorizedInterceptor } from './lib/auth'

installUnauthorizedInterceptor()

createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <App />
  </HashRouter>,
)
