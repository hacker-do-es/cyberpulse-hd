import { tr } from '@/lib/i18n';
import { Routes, Route } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import Layout from './components/Layout'
import LoginPage from './components/LoginPage'
import { AuthProvider, useAuth } from './lib/auth'
import { I18nProvider } from './lib/i18n'

function Gate() {
  const { me, loading, refresh } = useAuth()
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-bg-primary">
        <span className="text-[11px] font-jetbrains uppercase tracking-[0.12em] text-text-tertiary">{tr("Loading…")}</span>
      </div>
    )
  }
  if (!me) return <LoginPage onLoggedIn={() => void refresh()} />
  /* Tenant-scoped tabs are keyed by company inside Layout, so switching
     company reloads their data without resetting the whole shell. */
  return <Layout key={me.user.id} />
}

export default function App() {
  return (
    <I18nProvider>
    <AuthProvider>
      <Toaster position="top-right" richColors theme="dark" />
      <Routes>
        <Route path="/" element={<Gate />} />
      </Routes>
    </AuthProvider>
    </I18nProvider>
  )
}
